"""Loopback-only report-folder search and open helper for Windows.

The public contract in this module is deliberately small:
``ReportExplorerError``, ``ReportExplorerService`` and ``create_server``.
No HTTP endpoint mutates files and an open request only accepts a temporary,
opaque result token created by ``search``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import signal
import stat
import subprocess
import threading
import time
import unicodedata
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from typing import Any, Callable


LOOPBACK_HOST = "127.0.0.1"
PORT = 17653
DEFAULT_REPORT_STORAGE_ROOT = r"Z:\data\측정팀\측정보고서"
PRODUCTION_ORIGIN = "https://html-tan-six.vercel.app"
DEVELOPMENT_ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
MAX_REQUEST_BYTES = 1_048_576


class ReportExplorerError(Exception):
    """A stable, serializable error returned by the helper API."""

    def __init__(self, code: str, http_status: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.message = message


@dataclass(frozen=True)
class _OpenRecord:
    path: str
    report_root: str
    period_root: str
    expires_at: float


def _configure_logging() -> logging.Logger:
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
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


LOGGER = _configure_logging()


def normalize_business_name(value: str) -> str:
    """Normalize only for comparison; user-visible folder names stay untouched."""
    normalized = unicodedata.normalize("NFC", value)
    normalized = re.sub(r"\s+", " ", normalized).strip().casefold()
    normalized = re.sub(r"\(\s*주\s*\)", "", normalized)
    normalized = normalized.replace("㈜", "").replace("주식회사", "")
    return re.sub(r"\s+", " ", normalized).strip()


def _canonical(path: str | os.PathLike[str]) -> str:
    return os.path.realpath(os.path.abspath(os.fspath(path)))


def _is_within(candidate: str, parent: str) -> bool:
    try:
        return (
            os.path.commonpath([os.path.normcase(candidate), os.path.normcase(parent)])
            == os.path.normcase(parent)
        )
    except ValueError:
        return False


def configured_report_root() -> str:
    return _canonical(os.environ.get("REPORT_STORAGE_ROOT", DEFAULT_REPORT_STORAGE_ROOT))


def configured_origins() -> set[str]:
    additions = os.environ.get("REPORT_EXPLORER_ALLOWED_ORIGINS", "")
    explicit_additions = {
        origin.strip() for origin in re.split(r"[,;]", additions) if origin.strip()
    }
    return {PRODUCTION_ORIGIN, *DEVELOPMENT_ORIGINS, *explicit_additions}


def configured_token_ttl_seconds() -> int:
    raw_value = os.environ.get("REPORT_EXPLORER_RESULT_TTL_SECONDS", "")
    if not raw_value:
        return 300
    try:
        return max(30, min(int(raw_value), 3_600))
    except ValueError:
        LOGGER.warning("Invalid REPORT_EXPLORER_RESULT_TTL_SECONDS; using default")
        return 300


def launch_explorer(directory: str) -> None:
    """Isolated Windows integration; request data never reaches a shell."""
    if hasattr(os, "startfile"):
        os.startfile(directory)  # type: ignore[attr-defined]
        return
    subprocess.Popen(["explorer.exe", directory], close_fds=True)


class ReportExplorerService:
    def __init__(
        self,
        root: str | os.PathLike[str],
        launcher: Callable[[str], None] | None = None,
        token_ttl_seconds: float = 300,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not isinstance(root, (str, os.PathLike)):
            raise TypeError("root must be a filesystem path")
        if token_ttl_seconds <= 0:
            raise ValueError("token_ttl_seconds must be positive")
        self.root = _canonical(root)
        self._launcher = launcher or launch_explorer
        self._token_ttl_seconds = token_ttl_seconds
        self._clock = clock
        self._records: dict[str, _OpenRecord] = {}
        self._records_lock = threading.Lock()

    @staticmethod
    def _require_directory(path: str, missing_code: str, missing_status: int, missing_message: str) -> None:
        try:
            mode = os.stat(path).st_mode
        except PermissionError as exc:
            raise ReportExplorerError(
                "STORAGE_PERMISSION_DENIED", 403, "보고서 저장소 폴더에 접근할 권한이 없습니다."
            ) from exc
        except FileNotFoundError as exc:
            raise ReportExplorerError(missing_code, missing_status, missing_message) from exc
        except OSError as exc:
            raise ReportExplorerError(
                "STORAGE_ROOT_UNAVAILABLE", 503, "보고서 저장소에 접근할 수 없습니다."
            ) from exc
        if not stat.S_ISDIR(mode):
            raise ReportExplorerError(missing_code, missing_status, missing_message)

    def health(self) -> dict[str, Any]:
        """Report helper and configured storage availability without enumerating data."""
        try:
            available = stat.S_ISDIR(os.stat(self.root).st_mode)
            reason = None if available else "STORAGE_ROOT_UNAVAILABLE"
        except PermissionError:
            available = False
            reason = "STORAGE_PERMISSION_DENIED"
        except OSError:
            available = False
            reason = "STORAGE_ROOT_UNAVAILABLE"
        storage: dict[str, Any] = {"available": available, "root": self.root}
        if reason:
            storage["reason"] = reason
        return {"status": "ok", "version": "1", "storage": storage}

    def _available_root(self) -> str:
        drive, _ = os.path.splitdrive(self.root)
        if drive and not os.path.exists(drive + os.path.sep):
            raise ReportExplorerError(
                "STORAGE_ROOT_UNAVAILABLE", 503, "보고서 저장 드라이브를 사용할 수 없습니다."
            )
        self._require_directory(
            self.root,
            "STORAGE_ROOT_UNAVAILABLE",
            503,
            "보고서 저장소 루트를 사용할 수 없습니다.",
        )
        return self.root

    @staticmethod
    def _validate_search_inputs(
        year: Any, period: Any, business_names: Any
    ) -> tuple[int, str, list[str]]:
        if isinstance(year, bool) or not isinstance(year, int) or not 1000 <= year <= 9999:
            raise ReportExplorerError("INVALID_REQUEST", 400, "year는 네 자리 숫자여야 합니다.")
        if period not in {"상반기", "하반기"}:
            raise ReportExplorerError("INVALID_REQUEST", 400, "period가 올바르지 않습니다.")
        if not isinstance(business_names, list) or not business_names:
            raise ReportExplorerError(
                "INVALID_REQUEST", 400, "businessNames는 비어 있지 않은 문자열 목록이어야 합니다."
            )
        if any(
            not isinstance(name, str)
            or not normalize_business_name(name)
            or "\x00" in name
            or "/" in name
            or "\\" in name
            or ".." in name
            for name in business_names
        ):
            raise ReportExplorerError(
                "INVALID_REQUEST", 400, "businessNames는 비어 있지 않은 문자열 목록이어야 합니다."
            )
        return year, period, business_names

    def _period_root(self, year: int, period: str) -> tuple[str, str]:
        root = self._available_root()
        year_root = _canonical(os.path.join(root, f"{year}년"))
        self._require_directory(year_root, "YEAR_NOT_FOUND", 404, "요청한 연도 폴더를 찾을 수 없습니다.")
        if not _is_within(year_root, root):
            raise ReportExplorerError("PATH_NOT_ALLOWED", 403, "허용된 저장소 범위를 벗어난 경로입니다.")

        period_root = _canonical(os.path.join(year_root, period))
        self._require_directory(period_root, "PERIOD_NOT_FOUND", 404, "요청한 반기 폴더를 찾을 수 없습니다.")
        if not _is_within(period_root, root) or not _is_within(period_root, year_root):
            raise ReportExplorerError("PATH_NOT_ALLOWED", 403, "허용된 저장소 범위를 벗어난 경로입니다.")
        return root, period_root

    def _new_result_id(self, path: str, root: str, period_root: str) -> str:
        result_id = secrets.token_urlsafe(32)
        record = _OpenRecord(
            path=path,
            report_root=root,
            period_root=period_root,
            expires_at=self._clock() + self._token_ttl_seconds,
        )
        with self._records_lock:
            now = self._clock()
            self._records = {
                key: value for key, value in self._records.items() if value.expires_at > now
            }
            self._records[result_id] = record
        return result_id

    def search(self, year: Any, period: Any, business_names: Any) -> dict[str, Any]:
        year, period, business_names = self._validate_search_inputs(year, period, business_names)
        root, period_root = self._period_root(year, period)

        # The only period-directory scan in this request.
        try:
            with os.scandir(period_root) as entries:
                folders = []
                for entry in entries:
                    if not entry.is_dir(follow_symlinks=False):
                        continue
                    folder_path = _canonical(entry.path)
                    if _is_within(folder_path, root) and _is_within(folder_path, period_root):
                        folders.append((entry.name, folder_path, normalize_business_name(entry.name)))
        except PermissionError as exc:
            raise ReportExplorerError(
                "STORAGE_PERMISSION_DENIED", 403, "보고서 저장소 폴더를 읽을 권한이 없습니다."
            ) from exc
        except OSError as exc:
            raise ReportExplorerError(
                "STORAGE_ROOT_UNAVAILABLE", 503, "보고서 저장소에 접근할 수 없습니다."
            ) from exc

        results: list[dict[str, Any]] = []
        for query in business_names:
            normalized_query = normalize_business_name(query)
            exact = [
                (folder_name, folder_path)
                for folder_name, folder_path, normalized_folder in folders
                if normalized_folder == normalized_query
            ]
            candidates = exact or [
                (folder_name, folder_path)
                for folder_name, folder_path, normalized_folder in folders
                if normalized_query in normalized_folder or normalized_folder in normalized_query
            ]
            matches = [
                {
                    "resultId": self._new_result_id(folder_path, root, period_root),
                    "folderName": folder_name,
                    "path": folder_path,
                }
                for folder_name, folder_path in candidates
            ]
            results.append(
                {
                    "query": query,
                    "status": "FOUND" if len(matches) == 1 else "MULTIPLE" if matches else "NOT_FOUND",
                    "matches": matches,
                }
            )
        return {"results": results, "directoryReadCount": 1}

    def open_result(self, result_id: Any) -> dict[str, bool]:
        if not isinstance(result_id, str) or not result_id.strip():
            raise ReportExplorerError("INVALID_REQUEST", 400, "resultId가 올바르지 않습니다.")
        with self._records_lock:
            record = self._records.pop(result_id, None)
        if record is None or record.expires_at <= self._clock():
            raise ReportExplorerError("RESULT_NOT_FOUND", 404, "검색 결과를 찾을 수 없거나 만료되었습니다.")

        root = self._available_root()
        period_root = _canonical(record.period_root)
        target = _canonical(record.path)
        self._require_directory(
            period_root, "PATH_NOT_ALLOWED", 403, "허용된 저장소 범위의 폴더만 열 수 있습니다."
        )
        self._require_directory(
            target, "PATH_NOT_ALLOWED", 403, "허용된 저장소 범위의 폴더만 열 수 있습니다."
        )
        if (
            os.path.normcase(root) != os.path.normcase(record.report_root)
            or not _is_within(period_root, root)
            or not _is_within(target, root)
            or not _is_within(target, period_root)
        ):
            raise ReportExplorerError(
                "PATH_NOT_ALLOWED", 403, "허용된 저장소 범위의 폴더만 열 수 있습니다."
            )

        try:
            self._launcher(target)
        except OSError as exc:
            LOGGER.exception("Explorer launch failed: %s", exc)
            raise ReportExplorerError("OPEN_FAILED", 500, "Windows 탐색기를 열지 못했습니다.") from exc
        return {"ok": True}


def _parse_json_body(handler: BaseHTTPRequestHandler) -> Any:
    try:
        content_length = int(handler.headers.get("Content-Length", ""))
    except ValueError as exc:
        raise ReportExplorerError("INVALID_REQUEST", 400, "Content-Length가 올바르지 않습니다.") from exc
    if content_length < 1 or content_length > MAX_REQUEST_BYTES:
        raise ReportExplorerError("INVALID_REQUEST", 400, "요청 본문 크기가 올바르지 않습니다.")
    try:
        return json.loads(handler.rfile.read(content_length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReportExplorerError("INVALID_REQUEST", 400, "JSON 본문이 올바르지 않습니다.") from exc


def _parse_search_payload(payload: Any) -> tuple[int, str, list[str]]:
    if not isinstance(payload, dict) or set(payload) != {"year", "period", "businessNames"}:
        raise ReportExplorerError(
            "INVALID_REQUEST", 400, "year, period, businessNames만 지정할 수 있습니다."
        )
    return ReportExplorerService._validate_search_inputs(
        payload["year"], payload["period"], payload["businessNames"]
    )


def _parse_open_payload(payload: Any) -> str:
    if not isinstance(payload, dict) or set(payload) != {"resultId"}:
        raise ReportExplorerError("INVALID_REQUEST", 400, "resultId만 지정할 수 있습니다.")
    result_id = payload["resultId"]
    if not isinstance(result_id, str) or not result_id.strip():
        raise ReportExplorerError("INVALID_REQUEST", 400, "resultId가 올바르지 않습니다.")
    return result_id


class _RequestHandler(BaseHTTPRequestHandler):
    server_version = "ReportExplorerHelper/1.0"
    sys_version = ""
    service: ReportExplorerService

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.client_address[0], format % args)

    def _origin_is_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is not None and origin in configured_origins()

    def _send_json(self, status: int, payload: dict[str, Any], *, cors: bool = False) -> None:
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
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browsers can cancel health/search requests during navigation or refresh.
            return

    def _send_error(self, error: ReportExplorerError, *, cors: bool = False) -> None:
        self._send_json(
            error.http_status,
            {"error": {"code": error.code, "message": error.message}},
            cors=cors,
        )

    def _require_origin(self) -> bool:
        if self._origin_is_allowed():
            return True
        self._send_error(
            ReportExplorerError("FORBIDDEN_ORIGIN", 403, "허용되지 않은 Origin입니다.")
        )
        return False

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_error(ReportExplorerError("INVALID_REQUEST", 400, "지원하지 않는 경로입니다."))
            return
        if self.headers.get("Origin") is not None and not self._origin_is_allowed():
            self._send_error(
                ReportExplorerError("FORBIDDEN_ORIGIN", 403, "허용되지 않은 Origin입니다.")
            )
            return
        # Origin-less health remains available to local diagnostics.
        self._send_json(200, self.service.health(), cors=self._origin_is_allowed())

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._require_origin():
            return
        if self.path not in {"/report-explorer/search", "/report-explorer/open"}:
            self._send_error(
                ReportExplorerError("INVALID_REQUEST", 400, "지원하지 않는 경로입니다."), cors=True
            )
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if not self._require_origin():
            return
        try:
            payload = _parse_json_body(self)
            if self.path == "/report-explorer/search":
                year, period, business_names = _parse_search_payload(payload)
                response = self.service.search(year, period, business_names)
            elif self.path == "/report-explorer/open":
                response = self.service.open_result(_parse_open_payload(payload))
            else:
                raise ReportExplorerError("INVALID_REQUEST", 400, "지원하지 않는 경로입니다.")
            self._send_json(200, response, cors=True)
        except ReportExplorerError as error:
            self._send_error(error, cors=True)
        except OSError as error:
            LOGGER.exception("Storage access failed: %s", error)
            self._send_error(
                ReportExplorerError(
                    "STORAGE_ROOT_UNAVAILABLE", 503, "보고서 저장소에 접근할 수 없습니다."
                ),
                cors=True,
            )


class _LoopbackServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def create_server(
    host: str = LOOPBACK_HOST,
    port: int = PORT,
    service: ReportExplorerService | None = None,
) -> ThreadingHTTPServer:
    """Create a testable server that is always bound to the IPv4 loopback address."""
    if host != LOOPBACK_HOST:
        raise ValueError("Report Explorer Helper must bind only to 127.0.0.1")
    active_service = service or ReportExplorerService(
        configured_report_root(), token_ttl_seconds=configured_token_ttl_seconds()
    )
    handler = type("ReportExplorerRequestHandler", (_RequestHandler,), {"service": active_service})
    server = _LoopbackServer((host, port), handler)
    server.service = active_service  # type: ignore[attr-defined]
    return server


def run() -> int:
    server = create_server()
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
