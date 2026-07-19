from __future__ import annotations

import argparse
import asyncio
import gc
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

DOCUMENT_TYPES = {
    "GENERAL_PRELIMINARY_SURVEY": {
        "extension": ".hwpx",
        "fields": [
            "measurement_year", "measurement_period", "business_name", "representative_name",
            "address", "business_category", "phone", "main_product", "fax", "total_employees",
            "manager_name", "manager_email", "manager_contact", "preliminary_surveyor",
            "business_number", "industrial_accident_number",
        ],
    },
    "FIELD_PRELIMINARY_SURVEY": {
        "extension": ".hwpx",
        "fields": [
            "measurement_year", "measurement_period", "business_name", "representative_name",
            "address", "business_category", "phone", "main_product", "fax", "total_employees",
            "manager_name", "manager_email", "manager_contact",
        ],
    },
    "MEASUREMENT_PLAN_XLSM": {"extension": ".xlsm"},
}

XLSM_CELLS = {
    "B1": "business_year_period_label",
    "G1": "manager_name",
    "C2": "manager_email",
    "F2": "manager_contact",
    "I2": "invoice_email",
}

LOGGER = logging.getLogger("document-worker")
WORKER_VERSION = "2026.07.19.4"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def normalize_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def normalize_measurement_period(value: Any) -> str:
    normalized = normalize_text(value)
    if normalized in {"상반기", "1", "상"}:
        return "상반기"
    if normalized in {"하반기", "2", "하"}:
        return "하반기"
    raise ValueError("지원하지 않는 측정주기입니다.")


def format_business_number(value: Any) -> str:
    original = normalize_text(value)
    digits = "".join(character for character in original if character.isdigit())
    return f"{digits[:3]}-{digits[3:5]}-{digits[5:]}" if len(digits) == 10 else original


def build_manager_contact(manager_mobile: Any, manager_phone: Any) -> str:
    return normalize_text(manager_mobile) or normalize_text(manager_phone)


def sanitize_windows_filename(value: Any, fallback: str = "사업장") -> str:
    sanitized = re.sub(r'[\\/:*?"<>|]', "_", normalize_text(value))
    sanitized = re.sub(r"\s+", " ", sanitized).strip().rstrip(". ")
    return sanitized or fallback


def build_output_path(root: Path, snapshot: dict[str, Any]) -> Path:
    period = normalize_measurement_period(snapshot.get("measurement_period"))
    business_name = sanitize_windows_filename(snapshot.get("business_name"), normalize_text(snapshot.get("business_code")) or "사업장")
    return root / f"{normalize_text(snapshot.get('measurement_year'))}년" / period / "(((미확정 사업장)))" / business_name


def build_filename(document_type: str, snapshot: dict[str, Any]) -> str:
    year = normalize_text(snapshot.get("measurement_year"))[-2:]
    period = "상" if normalize_measurement_period(snapshot.get("measurement_period")) == "상반기" else "하"
    name = sanitize_windows_filename(snapshot.get("business_name"), normalize_text(snapshot.get("business_code")) or "사업장")
    if document_type == "GENERAL_PRELIMINARY_SURVEY":
        return f"{name}(예비조사표-{year}{period}).hwpx"
    if document_type == "FIELD_PRELIMINARY_SURVEY":
        return f"{name}(현장 예비조사표-{year}{period}).hwpx"
    if document_type == "MEASUREMENT_PLAN_XLSM":
        return f"★ {name}({year}{period})_화학물질입력 및 측정계획(V2.0).xlsm"
    raise ValueError(f"지원하지 않는 문서 종류입니다: {document_type}")


def unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate = path.with_name(f"{path.stem}_{stamp}{path.suffix}")
    sequence = 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}_{stamp}_{sequence}{path.suffix}")
        sequence += 1
    return candidate


def publish_file(source: Path, requested_destination: Path, attempts: int = 10, delay_seconds: float = 0.5) -> Path:
    last_error: PermissionError | None = None
    for attempt in range(attempts):
        destination = unique_destination(requested_destination)
        try:
            shutil.copy2(source, destination)
            return destination
        except PermissionError as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(delay_seconds)
    if last_error is not None:
        raise last_error
    raise RuntimeError("생성 파일 게시에 실패했습니다.")


def mask_email(value: Any) -> str:
    text = normalize_text(value)
    if "@" not in text:
        return ""
    local, domain = text.split("@", 1)
    return f"{local[:1]}***@{domain}"


def mask_phone(value: Any) -> str:
    digits = "".join(character for character in normalize_text(value) if character.isdigit())
    return f"{digits[:3]}-****-{digits[-4:]}" if len(digits) >= 7 else ""


class HwpxAutomation:
    def fill(self, path: Path, values: dict[str, str], required_fields: list[str]) -> None:
        import win32com.client  # type: ignore

        hwp = None
        stage = "COM 객체 생성"
        try:
            hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
            security_module = os.environ.get("HWP_SECURITY_MODULE", "FilePathCheckDLL")
            security_module_name = os.environ.get("HWP_SECURITY_MODULE_NAME", "FilePathCheckerModule")
            stage = "보안 모듈 등록"
            try:
                hwp.RegisterModule(security_module, security_module_name)
            except Exception:
                LOGGER.warning("한글 보안 모듈 등록을 건너뜁니다.")

            stage = "문서 열기"
            if not hwp.Open(str(path), "HWPX", "forceopen:true"):
                raise RuntimeError("HWPX 복사본을 열지 못했습니다.")

            stage = "누름틀 목록 조회"
            raw_fields = normalize_text(hwp.GetFieldList(0, 0))
            available = {
                re.sub(r"[{][{][0-9]+[}][}]$", "", field)
                for field in re.split(f"[{chr(2)}{chr(13)}{chr(10)}]+", raw_fields)
                if field
            }
            missing = [field for field in required_fields if field not in available]
            if missing:
                raise RuntimeError("누락된 HWPX 누름틀: " + ", ".join(missing))

            stage = "누름틀 값 입력"
            for field in required_fields:
                hwp.PutFieldText(field, normalize_text(values.get(field)))

            stage = "문서 저장"
            if not hwp.Save(True):
                raise RuntimeError("HWPX 저장에 실패했습니다.")
        except Exception as error:
            raise RuntimeError(f"HWPX {stage} 단계 실패: {error}") from error
        finally:
            if hwp is not None:
                try:
                    hwp.Clear(1)
                except Exception:
                    pass
                try:
                    hwp.Quit()
                except Exception:
                    pass
            del hwp
            gc.collect()

class ExcelAutomation:
    def fill(self, path: Path, values: dict[str, str]) -> None:
        import win32com.client  # type: ignore

        excel = None
        workbook = None
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            workbook = excel.Workbooks.Open(str(path))
            sheet = workbook.Worksheets("측정계획(양식)")
            for cell_address, value_key in XLSM_CELLS.items():
                cell = sheet.Range(cell_address)
                target = cell.MergeArea.Cells(1, 1) if cell.MergeCells else cell
                target.Value = normalize_text(values.get(value_key))
            workbook.Save()
        finally:
            if workbook is not None:
                try:
                    workbook.Close(SaveChanges=False)
                except Exception:
                    pass
            if excel is not None:
                try:
                    excel.Quit()
                except Exception:
                    pass
            del workbook
            del excel
            gc.collect()


class DocumentWorkerClient:
    def __init__(self, base_url: str, token: str, worker_id: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.worker_id = worker_id

    def _request(self, path: str, method: str = "GET", body: dict[str, Any] | None = None) -> bytes:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "measurement-document-worker/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()

    def claim(self) -> dict[str, Any] | None:
        result = json.loads(self._request("/api/document-worker/jobs/claim", "POST", {"worker_id": self.worker_id}))
        return result.get("job")

    def download_template(self, job_id: str, template_id: str, destination: Path) -> None:
        try:
            content = self._request(f"/api/document-worker/jobs/{job_id}/templates/{template_id}")
        except urllib.error.HTTPError as error:
            response_body = error.read().decode("utf-8", "replace").strip()
            detail = response_body[:500] or error.reason
            raise RuntimeError(f"템플릿 다운로드 실패 (HTTP {error.code}): {detail}") from error
        destination.write_bytes(content)
    def complete(self, job_id: str, status: str, results: list[dict[str, Any]], error_message: str | None) -> None:
        self._request(f"/api/document-worker/jobs/{job_id}/complete", "POST", {
            "worker_id": self.worker_id,
            "status": status,
            "result_files": results,
            "error_message": error_message,
        })


def verify_download(path: Path, template: dict[str, Any]) -> None:
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError("다운로드한 템플릿이 비어 있습니다.")
    expected_size = int(template.get("size_bytes") or 0)
    if expected_size and path.stat().st_size != expected_size:
        raise RuntimeError("다운로드한 템플릿 크기가 등록 정보와 다릅니다.")
    expected_hash = normalize_text(template.get("sha256"))
    if expected_hash:
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash.lower() != expected_hash.lower():
            raise RuntimeError("다운로드한 템플릿 해시가 등록 정보와 다릅니다.")


def process_job(
    job: dict[str, Any],
    client: DocumentWorkerClient,
    output_root: Path,
    hwpx: HwpxAutomation | None = None,
    excel: ExcelAutomation | None = None,
) -> tuple[str, list[dict[str, Any]], str | None]:
    payload = job.get("payload") or {}
    snapshot = {key: normalize_text(value) for key, value in (payload.get("snapshot") or {}).items()}
    snapshot["business_number"] = format_business_number(snapshot.get("business_number"))
    snapshot["manager_contact"] = build_manager_contact(snapshot.get("manager_mobile"), snapshot.get("manager_phone"))
    snapshot["business_year_period_label"] = (
        f"{snapshot.get('business_name', '')}({snapshot.get('measurement_year', '')}년 "
        f"{normalize_measurement_period(snapshot.get('measurement_period'))})"
    )
    templates = payload.get("templates") or {}
    selected = payload.get("selected_documents") or job.get("selected_documents") or []
    final_folder = build_output_path(output_root, snapshot)
    final_folder.mkdir(parents=True, exist_ok=True)
    hwpx = hwpx or HwpxAutomation()
    excel = excel or ExcelAutomation()
    results: list[dict[str, Any]] = []

    LOGGER.info(
        "작업 시작 id=%s code=%s business=%s year=%s period=%s documents=%s email=%s phone=%s output=%s",
        job.get("id"), snapshot.get("business_code"), snapshot.get("business_name"),
        snapshot.get("measurement_year"), snapshot.get("measurement_period"), selected,
        mask_email(snapshot.get("manager_email")), mask_phone(snapshot.get("manager_contact")), final_folder,
    )

    with tempfile.TemporaryDirectory(prefix="measurement-doc-") as temporary:
        temporary_root = Path(temporary)
        for document_type in selected:
            result: dict[str, Any] = {"document_type": document_type, "status": "FAILED"}
            try:
                definition = DOCUMENT_TYPES.get(document_type)
                template = templates.get(document_type)
                if not definition or not template:
                    raise RuntimeError("작업에 고정된 템플릿 정보가 없습니다.")
                extension = definition["extension"]
                template_file = temporary_root / f"template-{document_type}{extension}"
                client.download_template(str(job["id"]), str(template["template_id"]), template_file)
                verify_download(template_file, template)
                working_file = temporary_root / build_filename(document_type, snapshot)
                shutil.copy2(template_file, working_file)

                if extension == ".hwpx":
                    fields = list(definition["fields"])
                    hwpx.fill(working_file, snapshot, fields)
                    result["input_fields"] = fields
                else:
                    excel.fill(working_file, snapshot)
                    result["input_fields"] = list(XLSM_CELLS.values())

                if not working_file.exists() or working_file.stat().st_size <= 0:
                    raise RuntimeError("저장 검증에 실패했습니다.")
                destination = publish_file(working_file, final_folder / working_file.name)
                result.update({"status": "COMPLETED", "filename": destination.name, "path": str(destination)})
            except Exception as error:
                result["error"] = str(error)
                LOGGER.exception("문서 생성 실패 job=%s type=%s", job.get("id"), document_type)
            results.append(result)

    completed = sum(result["status"] == "COMPLETED" for result in results)
    status = "COMPLETED" if completed == len(results) and results else "PARTIAL_SUCCESS" if completed else "FAILED"
    errors = [f"{result['document_type']}: {result.get('error')}" for result in results if result["status"] != "COMPLETED"]
    return status, results, "; ".join(errors) or None


def process_next_queued_job(client: DocumentWorkerClient, output_root: Path) -> str | None:
    pythoncom = None
    try:
        try:
            import pythoncom as win32_pythoncom  # type: ignore

            pythoncom = win32_pythoncom
            pythoncom.CoInitialize()
        except ImportError:
            pass

        job = client.claim()
        if not job:
            return None
        status, results, error_message = process_job(job, client, output_root)
        client.complete(str(job["id"]), status, results, error_message)
        LOGGER.info("작업 완료 id=%s status=%s", job.get("id"), status)
        return str(job["id"])
    finally:
        if pythoncom is not None:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


def run_worker(once: bool = False) -> int:
    from document_worker_realtime import (
        ClaimCoordinator,
        DocumentWorkerRuntime,
        RealtimeSettings,
        env_flag,
        masked_supabase_url,
    )

    project_root = Path(__file__).resolve().parent
    load_env_file(project_root / ".env.local")
    base_url = (
        os.environ.get("DOCUMENT_WORKER_API_BASE_URL")
        or os.environ.get("DOCUMENT_WORKER_API_URL")
        or os.environ.get("WEB_API_URL")
        or "http://localhost:3000"
    )
    token = os.environ.get("DOCUMENT_WORKER_TOKEN", "")
    output_root = Path(os.environ.get("DOCUMENT_OUTPUT_ROOT") or r"Z:\data\측정팀\측정보고서")
    worker_id = os.environ.get("DOCUMENT_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    if not token:
        LOGGER.error("DOCUMENT_WORKER_TOKEN이 설정되지 않았습니다.")
        return 2

    client = DocumentWorkerClient(base_url, token, worker_id)
    process_next = lambda: process_next_queued_job(client, output_root)
    if once:
        try:
            process_next()
            return 0
        except urllib.error.HTTPError as error:
            LOGGER.error(
                "Worker API 오류 status=%s body=%s",
                error.code,
                error.read().decode("utf-8", "ignore")[:500],
            )
            return 1
        except Exception:
            LOGGER.exception("문서 Worker 단발 실행 오류")
            return 1

    try:
        recovery_poll_seconds = max(
            10, int(os.environ.get("DOCUMENT_WORKER_RECOVERY_POLL_SECONDS", "300"))
        )
    except ValueError:
        LOGGER.error("DOCUMENT_WORKER_RECOVERY_POLL_SECONDS는 정수여야 합니다.")
        return 2

    realtime_enabled = env_flag(os.environ.get("DOCUMENT_WORKER_REALTIME_ENABLED"), True)
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    realtime_key = (
        os.environ.get("SUPABASE_REALTIME_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    )
    if realtime_enabled and (not supabase_url or not realtime_key):
        LOGGER.error(
            "Realtime 환경변수가 부족하여 복구 폴링 전용으로 실행합니다. "
            "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL 및 "
            "SUPABASE_REALTIME_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY를 확인하세요."
        )
        realtime_enabled = False

    settings = RealtimeSettings(
        enabled=realtime_enabled,
        supabase_url=supabase_url,
        realtime_key=realtime_key,
        recovery_poll_seconds=recovery_poll_seconds,
    )
    LOGGER.info(
        "문서 Worker 시작 version=%s worker=%s api=%s root=%s realtime=%s recovery=%ss supabase=%s",
        WORKER_VERSION,
        worker_id,
        base_url,
        output_root,
        realtime_enabled,
        recovery_poll_seconds,
        masked_supabase_url(supabase_url),
    )

    coordinator = ClaimCoordinator(process_next)
    runtime = DocumentWorkerRuntime(coordinator, settings)
    try:
        asyncio.run(runtime.run())
    except KeyboardInterrupt:
        LOGGER.info("종료 신호 수신. Realtime과 현재 작업을 정리합니다.")
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(description="신규 사업장 문서 생성 Windows Worker")
    parser.add_argument("--once", action="store_true", help="작업을 한 번 확인한 뒤 종료")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [DocumentWorker] %(levelname)s %(message)s")
    return run_worker(arguments.once)


if __name__ == "__main__":
    raise SystemExit(main())
