"""Loopback-only report-folder search and open helper for Windows.

This process deliberately exposes no file mutation endpoint.  It is intended
to run on the employee PC that has access to the report storage drive.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import signal
import subprocess
import threading
import time
import unicodedata
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from typing import Any


LOOPBACK_HOST = "127.0.0.1"
PORT = 17653
DEFAULT_REPORT_STORAGE_ROOT = r"Z:\data\측정팀\측정보고서"
PRODUCTION_ORIGIN = "https://html-tan-six.vercel.app"
DEVELOPMENT_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
MAX_REQUEST_BYTES = 1_048_576
DEFAULT_RESULT_TTL_SECONDS = 300


class HelperError(Exception):
    def __init__(self, code: str, message: str, status: HTTPStatus) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class SearchResult:
    result_id: str
    folder_name: str
    path: str


@dataclass(frozen=True)
class OpenRecord:
    path: str
    report_root: str
    period_root: str
    expires_at: float


def configure_logging() -> logging.Logger:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        local_app_data = os.path.join(os.path.expanduser("~"), "AppData", "Local")
    log_directory = os.path.join(
        local_app_data, "MeasurementJournal", "ReportExplorerHelper", "logs"
    )
    os.makedirs(log_directory, exist_ok=True)

    logger = logging.getLogger("report_explorer_helper")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = RotatingFileHandler(
            os.path.join(log_directory, "report-explorer-helper.log"),
            maxBytes=1_048_576,
            backupCount=3,
            encoding="utf-8",
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(message)s")
        )
        logger.addHandler(handler)
    return logger


LOGGER = configure_logging()


def normalize_business_name(value: str) -> str:
    """Normalize names only for comparison; returned folder names stay unchanged."""
    normalized = unicodedata.normalize("NFC", value)
    normalized = re.sub(r"\s+", " ", normalized).strip().casefold()
    normalized = re.sub(r"\(\s*주\s*\)", "", normalized)
    normalized = normalized.replace("㈜", "").replace("주식회사", "")
    return re.sub(r"\s+", " ", normalized).strip()


def is_within(candidate: str, parent: str) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(candidate), os.path.normcase(parent)]) == os.path.normcase(parent)
    except ValueError:
        return False


def configured_report_root() -> str:
    return os.path.realpath(
        os.path.abspath(os.environ.get("REPORT_STORAGE_ROOT", DEFAULT_REPORT_STORAGE_ROOT))
    )


def configured_origins() -> set[str]:
    additions = os.environ.get("REPORT_EXPLORER_ALLOWED_ORIGINS", "")
    configured = {origin.strip() for origin in re.split(r"[,;]", additions) if origin.strip()}
    return {PRODUCTION_ORIGIN, *DEVELOPMENT_ORIGINS, *configured}


def result_ttl_seconds() -> int:
    raw_value = os.environ.get("REPORT_EXPLORER_RESULT_TTL_SECONDS", "")
    if not raw_value:
        return DEFAULT_RESULT_TTL_SECONDS
    try:
        return max(30, min(int(raw_value), 3_600))
    except ValueError:
        LOGGER.warning("Invalid REPORT_EXPLORER_RESULT_TTL_SECONDS; using default")
        return DEFAULT_RESULT_TTL_SECONDS


def ensure_report_root() -> str:
    root = configured_report_root()
    drive, _ = os.path.splitdrive(root)
    if drive and not os.path.exists(drive + os.path.sep):
        raise HelperError("DRIVE_UNAVAILABLE", "보고서 저장 드라이브를 사용할 수 없습니다.", HTTPStatus.SERVICE_UNAVAILABLE)
    if not os.path.isdir(root):
        raise HelperError("ROOT_UNAVAILABLE", "보고서 저장소 루트를 사용할 수 없습니다.", HTTPStatus.SERVICE_UNAVAILABLE)
    return root


def selected_period_root(root: str, year: int, period: str) -> str:
    year_path = os.path.join(root, f"{year}년")
    if not os.path.isdir(year_path):
        raise HelperError("YEAR_UNAVAILABLE", "요청한 연도 폴더를 사용할 수 없습니다.", HTTPStatus.NOT_FOUND)

    period_path = os.path.realpath(os.path.join(year_path, period))
    if not is_within(period_path, root) or not os.path.isdir(period_path):
        raise HelperError("PERIOD_UNAVAILABLE", "요청한 반기 폴더를 사용할 수 없습니다.", HTTPStatus.NOT_FOUND)
    return period_path


def parse_search_request(payload: Any) -> tuple[int, str, list[str]]:
    if not isinstance(payload, dict):
        raise HelperError("INVALID_INPUT", "JSON 객체가 필요합니다.", HTTPStatus.BAD_REQUEST)
    if set(payload) != {"year", "period", "businessNames"}:
        raise HelperError("INVALID_INPUT", "year, period, businessNames만 지정할 수 있습니다.", HTTPStatus.BAD_REQUEST)

    year = payload["year"]
    period = payload["period"]
    business_names = payload["businessNames"]
    if isinstance(year, bool) or not isinstance(year, int) or not 1000 <= year <= 9999:
        raise HelperError("INVALID_INPUT", "year는 네 자리 숫자여야 합니다.", HTTPStatus.BAD_REQUEST)
    if period not in {"상반기", "하반기"}:
        raise HelperError("INVALID_INPUT", "period는 상반기 또는 하반기여야 합니다.", HTTPStatus.BAD_REQUEST)
    if not isinstance(business_names, list) or not business_names or any(
        not isinstance(name, str) or not normalize_business_name(name) for name in business_names
    ):
        raise HelperError("INVALID_INPUT", "businessNames는 비어 있지 않은 사업장명 문자열 목록이어야 합니다.", HTTPStatus.BAD_REQUEST)
    return year, period, business_names


def parse_open_request(payload: Any) -> str:
    if not isinstance(payload, dict) or set(payload) != {"resultId"}:
        raise HelperError("INVALID_INPUT", "resultId만 지정할 수 있습니다.", HTTPStatus.BAD_REQUEST)
    result_id = payload["resultId"]
    if not isinstance(result_id, str) or not result_id.strip():
        raise HelperError("INVALID_RESULT_ID", "유효한 resultId가 필요합니다.", HTTPStatus.BAD_REQUEST)
    return result_id


def launch_explorer(directory: str) -> None:
    """Keep OS integration isolated so it is never coupled to request parsing."""
    if hasattr(os, "startfile"):
        os.startfile(directory)  # type: ignore[attr-defined]
        return
    subprocess.Popen(["explorer.exe", directory], close_fds=True)


class ReportExplorerService:
    def __init__(self) -> None:
        self._records: dict[str, OpenRecord] = {}
        self._records_lock = threading.Lock()

    def _store_open_record(self, path: str, root: str, period_root: str) -> str:
        result_id = secrets.token_urlsafe(32)
        record = OpenRecord(
            path=path,
            report_root=root,
            period_root=period_root,
            expires_at=time.monotonic() + result_ttl_seconds(),
        )
        with self._records_lock:
            now = time.monotonic()
            self._records = {
                key: value for key, value in self._records.items() if value.expires_at > now
            }
            self._records[result_id] = record
        return result_id

    def search(self, payload: Any) -> dict[str, Any]:
        year, period, business_names = parse_search_request(payload)
        root = ensure_report_root()
        period_root = selected_period_root(root, year, period)

        # This is intentionally the sole os.scandir call for a search request.
        with os.scandir(period_root) as entries:
            folders = [
                (entry.name, os.path.realpath(entry.path))
                for entry in entries
                if entry.is_dir(follow_symlinks=False)
                and is_within(os.path.realpath(entry.path), root)
                and is_within(os.path.realpath(entry.path), period_root)
            ]

        normalized_folders = [
            (folder_name, folder_path, normalize_business_name(folder_name))
            for folder_name, folder_path in folders
        ]
        results: list[dict[str, Any]] = []
        for query in business_names:
            normalized_query = normalize_business_name(query)
            exact_matches = [
                (folder_name, folder_path)
                for folder_name, folder_path, normalized_folder in normalized_folders
                if normalized_folder == normalized_query
            ]
            candidates = exact_matches or [
                (folder_name, folder_path)
                for folder_name, folder_path, normalized_folder in normalized_folders
                if normalized_query in normalized_folder or normalized_folder in normalized_query
            ]
            matches = [
                SearchResult(
                    result_id=self._store_open_record(folder_path, root, period_root),
                    folder_name=folder_name,
                    path=folder_path,
                )
                for folder_name, folder_path in candidates
            ]
            results.append(
                {
                    "query": query,
                    "status": "matched" if matches else "not_found",
                    "matches": [
                        {
                            "resultId": match.result_id,
                            "folderName": match.folder_name,
                            "path": match.path,
                        }
                        for match in matches
                    ],
                }
            )
        return {"results": results, "directoryReadCount": 1}

    def open(self, payload: Any) -> dict[str, bool]:
        result_id = parse_open_request(payload)
        with self._records_lock:
            record = self._records.pop(result_id, None)
        if record is None:
            raise HelperError("INVALID_RESULT_ID", "resultId를 찾을 수 없습니다.", HTTPStatus.NOT_FOUND)
        if record.expires_at <= time.monotonic():
            raise HelperError("EXPIRED_RESULT_ID", "resultId가 만료되었습니다. 다시 검색하세요.", HTTPStatus.GONE)

        current_root = ensure_report_root()
        if os.path.normcase(current_root) != os.path.normcase(record.report_root):
            raise HelperError("INVALID_RESULT_ID", "검색 결과의 저장소 범위가 변경되었습니다.", HTTPStatus.BAD_REQUEST)

        period_root = os.path.realpath(record.period_root)
        target = os.path.realpath(record.path)
        if (
            not os.path.isdir(period_root)
            or not os.path.isdir(target)
            or not is_within(period_root, current_root)
            or not is_within(target, current_root)
            or not is_within(target, period_root)
        ):
            raise HelperError("INVALID_RESULT_ID", "열 수 없는 검색 결과입니다.", HTTPStatus.BAD_REQUEST)

        try:
            launch_explorer(target)
        except OSError as exc:
            LOGGER.exception("Explorer launch failed: %s", exc)
            raise HelperError("OPEN_FAILED", "Windows 탐색기를 열지 못했습니다.", HTTPStatus.INTERNAL_SERVER_ERROR) from exc
        return {"opened": True}


SERVICE = ReportExplorerService()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "ReportExplorerHelper/1.0"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.client_address[0], format % args)

    def _origin_is_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is not None and origin in configured_origins()

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any], *, cors: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if cors:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, error: HelperError, *, cors: bool = False) -> None:
        self._send_json(error.status, {"error": {"code": error.code, "message": error.message}}, cors=cors)

    def _require_browser_origin(self) -> bool:
        if self._origin_is_allowed():
            return True
        self._send_error(
            HelperError("FORBIDDEN_ORIGIN", "허용되지 않은 Origin입니다.", HTTPStatus.FORBIDDEN)
        )
        return False

    def _read_json_body(self) -> Any:
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError as exc:
            raise HelperError("INVALID_INPUT", "Content-Length가 올바르지 않습니다.", HTTPStatus.BAD_REQUEST) from exc
        if content_length < 1 or content_length > MAX_REQUEST_BYTES:
            raise HelperError("INVALID_INPUT", "요청 본문 크기가 올바르지 않습니다.", HTTPStatus.BAD_REQUEST)
        try:
            return json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HelperError("INVALID_INPUT", "JSON 본문이 올바르지 않습니다.", HTTPStatus.BAD_REQUEST) from exc

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._require_browser_origin():
            return
        if self.path not in {"/report-explorer/search", "/report-explorer/open"}:
            self._send_error(HelperError("INVALID_INPUT", "지원하지 않는 경로입니다.", HTTPStatus.NOT_FOUND), cors=True)
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_error(HelperError("INVALID_INPUT", "지원하지 않는 경로입니다.", HTTPStatus.NOT_FOUND))
            return
        # Health is intentionally safe without an Origin: loopback-only and no storage data.
        self._send_json(HTTPStatus.OK, {"status": "ok", "service": "report-explorer-helper"}, cors=self._origin_is_allowed())

    def do_POST(self) -> None:  # noqa: N802
        if not self._require_browser_origin():
            return
        try:
            payload = self._read_json_body()
            if self.path == "/report-explorer/search":
                self._send_json(HTTPStatus.OK, SERVICE.search(payload), cors=True)
            elif self.path == "/report-explorer/open":
                self._send_json(HTTPStatus.OK, SERVICE.open(payload), cors=True)
            else:
                raise HelperError("INVALID_INPUT", "지원하지 않는 경로입니다.", HTTPStatus.NOT_FOUND)
        except HelperError as error:
            self._send_error(error, cors=True)
        except OSError as error:
            LOGGER.exception("Storage access failed: %s", error)
            self._send_error(
                HelperError("ROOT_UNAVAILABLE", "보고서 저장소에 접근할 수 없습니다.", HTTPStatus.SERVICE_UNAVAILABLE),
                cors=True,
            )


class LoopbackServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def run() -> int:
    server = LoopbackServer((LOOPBACK_HOST, PORT), RequestHandler)
    LOGGER.info("Started loopback helper on %s:%s", LOOPBACK_HOST, PORT)

    def stop_server(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, stop_server)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        LOGGER.info("Stopped by keyboard interrupt")
    finally:
        server.server_close()
        LOGGER.info("Loopback helper stopped")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except OSError as error:
        LOGGER.exception("Unable to start loopback helper: %s", error)
        raise SystemExit(f"Unable to bind {LOOPBACK_HOST}:{PORT}: {error}")
