from __future__ import annotations

import argparse
import asyncio
import atexit
import gc
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

WINDOWS_WORKER_MUTEX_NAME = r"Global\MeasurementJournalDocumentWorker"
ERROR_ALREADY_EXISTS = 183


class WindowsWorkerMutex:
    def __init__(
        self,
        name: str = WINDOWS_WORKER_MUTEX_NAME,
        *,
        platform_name: str | None = None,
        create_mutex: Any = None,
        get_last_error: Any = None,
        close_handle: Any = None,
    ) -> None:
        self.name = name
        self.platform_name = os.name if platform_name is None else platform_name
        self.create_mutex = create_mutex
        self.get_last_error = get_last_error
        self.close_handle = close_handle
        self.handle: Any = None

        if self.platform_name == "nt" and self.create_mutex is None:
            import ctypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
            kernel32.CreateMutexW.restype = ctypes.c_void_p
            kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel32.CloseHandle.restype = ctypes.c_bool
            self.create_mutex = kernel32.CreateMutexW
            self.get_last_error = ctypes.get_last_error
            self.close_handle = kernel32.CloseHandle

    def acquire(self) -> bool:
        if self.platform_name != "nt":
            return True

        handle = self.create_mutex(None, False, self.name)
        last_error = self.get_last_error()
        if not handle:
            raise OSError(last_error, "CreateMutexW failed")
        if last_error == ERROR_ALREADY_EXISTS:
            self.close_handle(handle)
            return False

        self.handle = handle
        return True

    def release(self) -> None:
        if self.handle is not None:
            self.close_handle(self.handle)
            self.handle = None


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

PRELIMINARY_SURVEY_OVERWRITE_CODES = {
    "GENERAL_PRELIMINARY_SURVEY",
    "INDUSTRIAL_SHOP_PRELIMINARY_SURVEY",
}

XLSM_CELLS = {
    "B1": "business_year_period_label",
    "G1": "manager_name",
    "C2": "manager_email",
    "F2": "manager_contact",
    "I2": "invoice_email",
}

FILE_FORMAT_EXTENSIONS = {
    "HWPX": ".hwpx",
    "XLSX": ".xlsx",
    "XLSM": ".xlsm",
}

LOGGER = logging.getLogger("document-worker")
WORKER_VERSION = "2026.08.25.3"
DOCUMENT_WORKER_HEARTBEAT_SECONDS = 15
DOCUMENT_WORKER_ORPHAN_RECOVERY_SECONDS = 15

HWPX_INTERNAL_CONTROL_VALUE = re.compile(
    r"(?:Clickhere\s*:|Direction\s*:\s*wstring\s*:|HelpState\s*:)", re.IGNORECASE
)
HWPX_PLACEHOLDER_GUIDE_VALUES = {
    "measurement_year": {"측정연도", "측정년도", "년도"},
    "measurement_period": {"측정주기", "주기"},
    "business_name": {"사업장명"},
    "representative_name": {"대표자", "대표자명"},
    "address": {"주소"},
    "business_category": {"업종", "업종분류"},
    "phone": {"전화번호"},
    "main_product": {"주요생산품", "주요 생산품"},
    "fax": {"팩스"},
    "total_employees": {"총 근로자수", "총 근로자 수"},
    "manager_name": {"담당자", "담당자명"},
    "manager_email": {"이메일", "담당자 이메일", "담당자 메일"},
    "manager_contact": {"연락처", "담당자 연락처"},
    "preliminary_surveyor": {"예비조사자"},
    "business_number": {"사업자등록번호"},
    "industrial_accident_number": {"산재관리번호"},
}


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


def sanitize_hwpx_mapping_default_value(source_field: Any, value: Any) -> str:
    normalized = re.sub(r"\s+", " ", normalize_text(value))
    if not normalized or HWPX_INTERNAL_CONTROL_VALUE.search(normalized):
        return ""
    guide_values = HWPX_PLACEHOLDER_GUIDE_VALUES.get(normalize_text(source_field), set())
    return "" if normalized in guide_values else normalized


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


def build_filename_from_definition(
    definition: dict[str, Any], snapshot: dict[str, Any]
) -> str:
    file_format = normalize_text(definition.get("file_format")).upper()
    extension = FILE_FORMAT_EXTENSIONS.get(file_format)
    if not extension:
        raise ValueError(f"지원하지 않는 파일 형식입니다: {file_format or '(빈 값)'}")
    pattern = normalize_text(definition.get("filename_pattern"))
    if not pattern:
        raise ValueError("작업에 고정된 파일명 규칙이 없습니다.")
    if re.search(r"\.(?:hwpx|xlsx|xlsm)$", pattern, re.IGNORECASE):
        raise ValueError("파일명 규칙에는 확장자를 포함할 수 없습니다.")

    year = normalize_text(snapshot.get("measurement_year"))
    period = normalize_measurement_period(snapshot.get("measurement_period"))
    replacements = {
        "business_name": normalize_text(snapshot.get("business_name")),
        "business_code": normalize_text(snapshot.get("business_code")),
        "year": year,
        "short_year": year[-2:],
        "period": period,
        "short_period": "상" if period == "상반기" else "하",
        "document_name": normalize_text(definition.get("name")),
    }
    unknown_variables: list[str] = []

    def replace_variable(match: re.Match[str]) -> str:
        variable = match.group(1)
        if variable not in replacements:
            unknown_variables.append(variable)
            return ""
        return replacements[variable]

    rendered = re.sub(r"\{([^{}]+)\}", replace_variable, pattern)
    if unknown_variables:
        raise ValueError(
            "지원하지 않는 파일명 변수입니다: "
            + ", ".join(sorted(set(unknown_variables)))
        )
    fallback = (
        normalize_text(definition.get("name"))
        or normalize_text(snapshot.get("business_code"))
        or "문서"
    )
    return sanitize_windows_filename(rendered, fallback) + extension


def resolve_mapping_values(
    mappings: list[dict[str, Any]], snapshot: dict[str, Any], document_name: str
) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    missing_sources: list[str] = []
    for mapping in sorted(mappings, key=lambda item: int(item.get("sort_order") or 0)):
        source_field = normalize_text(mapping.get("source_field"))
        value = normalize_text(snapshot.get(source_field))
        if not value:
            if mapping.get("target_type") == "HWPX_FIELD":
                value = sanitize_hwpx_mapping_default_value(
                    source_field, mapping.get("default_value")
                )
            else:
                value = normalize_text(mapping.get("default_value"))
        if bool(mapping.get("required")) and not value:
            missing_sources.append(source_field or "(알 수 없는 필드)")
        resolved.append({**mapping, "value": value})
    if missing_sources:
        raise RuntimeError(
            f"{document_name} 필수 입력값 누락: " + ", ".join(missing_sources)
        )
    return resolved


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


def publish_file(
    source: Path,
    requested_destination: Path,
    attempts: int = 10,
    delay_seconds: float = 0.5,
    overwrite: bool = False,
) -> Path:
    if overwrite:
        descriptor, staged_name = tempfile.mkstemp(
            prefix=f".{requested_destination.name}.",
            suffix=".tmp",
            dir=requested_destination.parent,
        )
        os.close(descriptor)
        staged = Path(staged_name)
        try:
            shutil.copy2(source, staged)
            last_error: PermissionError | None = None
            for attempt in range(attempts):
                try:
                    os.replace(staged, requested_destination)
                    return requested_destination
                except PermissionError as error:
                    last_error = error
                    if attempt + 1 < attempts:
                        time.sleep(delay_seconds)
            raise RuntimeError(
                "기존 예비조사표 파일을 교체할 수 없습니다. "
                f"파일이 열려 있는지 확인해 주세요: {requested_destination.name}"
            ) from last_error
        finally:
            staged.unlink(missing_ok=True)

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
            for field, value in values.items():
                normalized_value = normalize_text(value)
                if field in available and normalized_value:
                    hwp.PutFieldText(field, normalized_value)

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

    def fill_mappings(self, path: Path, mappings: list[dict[str, Any]]) -> None:
        import win32com.client  # type: ignore

        excel = None
        workbook = None
        stage = "COM 객체 생성"
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            stage = "문서 열기"
            workbook = excel.Workbooks.Open(str(path))
            for mapping in mappings:
                sheet_name = normalize_text(mapping.get("target_sheet"))
                cell_address = normalize_text(mapping.get("target_address")).upper()
                if not sheet_name:
                    raise RuntimeError("Excel 시트명이 비어 있습니다.")
                if not re.fullmatch(r"[A-Z]{1,3}[1-9][0-9]*", cell_address):
                    raise RuntimeError(f"Excel 셀 주소가 A1 형식이 아닙니다: {cell_address}")
                stage = f"셀 입력({sheet_name}!{cell_address})"
                try:
                    sheet = workbook.Worksheets(sheet_name)
                except Exception as error:
                    raise RuntimeError(f"Excel 시트를 찾을 수 없습니다: {sheet_name}") from error
                cell = sheet.Range(cell_address)
                target = cell.MergeArea.Cells(1, 1) if cell.MergeCells else cell
                target.Value = normalize_text(mapping.get("value"))
            stage = "문서 저장"
            workbook.Save()
        except Exception as error:
            raise RuntimeError(f"Excel {stage} 단계 실패: {error}") from error
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
    def __init__(
        self,
        base_url: str,
        token: str,
        worker_id: str,
        worker_lease_id: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.worker_id = worker_id
        self.worker_lease_id = worker_lease_id or str(uuid.uuid4())

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
        result = json.loads(
            self._request(
                "/api/document-worker/jobs/claim",
                "POST",
                {
                    "worker_id": self.worker_id,
                    "worker_lease_id": self.worker_lease_id,
                },
            )
        )
        return result.get("job")

    def download_template(self, job_id: str, template_id: str, destination: Path) -> None:
        try:
            content = self._request(f"/api/document-worker/jobs/{job_id}/templates/{template_id}")
        except urllib.error.HTTPError as error:
            response_body = error.read().decode("utf-8", "replace").strip()
            detail = response_body[:500] or error.reason
            raise RuntimeError(f"템플릿 다운로드 실패 (HTTP {error.code}): {detail}") from error
        destination.write_bytes(content)

    def heartbeat(
        self, job_id: str, result_files: list[dict[str, Any]] | None = None
    ) -> bool:
        body: dict[str, Any] = {
            "worker_id": self.worker_id,
            "worker_lease_id": self.worker_lease_id,
        }
        if result_files is not None:
            body["result_files"] = result_files
        result = json.loads(
            self._request(
                f"/api/document-worker/jobs/{job_id}/cancel-status", "POST", body
            )
        )
        return bool(result.get("cancel_requested"))

    def is_cancellation_requested(self, job_id: str) -> bool:
        return self.heartbeat(job_id)

    def checkpoint_progress(
        self, job_id: str, result_files: list[dict[str, Any]]
    ) -> bool:
        return self.heartbeat(job_id, result_files)

    def recover_cancelled_jobs(self) -> list[dict[str, Any]]:
        result = json.loads(
            self._request("/api/document-worker/jobs/recover-cancelled", "POST", {})
        )
        return list(result.get("recovered") or [])

    def complete(self, job_id: str, status: str, results: list[dict[str, Any]], error_message: str | None) -> None:
        self._request(f"/api/document-worker/jobs/{job_id}/complete", "POST", {
            "worker_id": self.worker_id,
            "worker_lease_id": self.worker_lease_id,
            "status": status,
            "result_files": results,
            "error_message": error_message,
        })


class JobLeaseHeartbeat:
    def __init__(
        self,
        client: Any,
        job_id: str,
        interval_seconds: float = DOCUMENT_WORKER_HEARTBEAT_SECONDS,
    ) -> None:
        self.client = client
        self.job_id = job_id
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def __enter__(self) -> "JobLeaseHeartbeat":
        if callable(getattr(self.client, "heartbeat", None)):
            self.thread = threading.Thread(
                target=self._run,
                name=f"document-job-heartbeat-{self.job_id}",
                daemon=True,
            )
            self.thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self.stop_event.wait(self.interval_seconds):
            try:
                self.client.heartbeat(self.job_id)
            except Exception as error:
                LOGGER.warning("Worker lease heartbeat 실패 job=%s error=%s", self.job_id, error)


class CancelledJobRecoveryMonitor:
    def __init__(
        self,
        client: Any,
        interval_seconds: float = DOCUMENT_WORKER_ORPHAN_RECOVERY_SECONDS,
    ) -> None:
        self.client = client
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if not callable(getattr(self.client, "recover_cancelled_jobs", None)):
            return
        self.thread = threading.Thread(
            target=self._run,
            name="document-job-cancellation-recovery",
            daemon=True,
        )
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self.stop_event.wait(self.interval_seconds):
            try:
                recovered = self.client.recover_cancelled_jobs()
                for job in recovered:
                    LOGGER.info(
                        "만료된 Worker lease 취소 종결 id=%s status=%s",
                        job.get("id"),
                        job.get("status"),
                    )
            except Exception as error:
                LOGGER.warning("취소 요청 고아 작업 복구 확인 실패: %s", error)


class DocumentGenerationCancelled(RuntimeError):
    pass


DOCUMENT_GENERATION_CANCELLED_MESSAGE = "문서 생성 취소 요청"


def is_job_cancellation_requested(client: Any, job_id: str) -> bool:
    checker = getattr(client, "is_cancellation_requested", None)
    return bool(checker(job_id)) if callable(checker) else False


def raise_if_job_cancellation_requested(client: Any, job_id: str) -> None:
    if is_job_cancellation_requested(client, job_id):
        raise DocumentGenerationCancelled(DOCUMENT_GENERATION_CANCELLED_MESSAGE)


def checkpoint_job_progress(
    client: Any, job_id: str, results: list[dict[str, Any]]
) -> tuple[bool, bool]:
    checkpoint = getattr(client, "checkpoint_progress", None)
    if not callable(checkpoint):
        return False, False
    try:
        return True, bool(checkpoint(job_id, results))
    except Exception as error:
        LOGGER.warning("문서 게시 결과 checkpoint 실패 job=%s error=%s", job_id, error)
        return True, False


def cancelled_document_result(
    document_type: str, dynamic_documents: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "document_type": document_type,
        "status": "CANCELLED",
        "error": DOCUMENT_GENERATION_CANCELLED_MESSAGE,
    }
    dynamic_document = dynamic_documents.get(document_type)
    if dynamic_document:
        result.update(
            {
                "document_definition_id": dynamic_document.get("document_definition_id"),
                "document_name": dynamic_document.get("name"),
                "file_format": normalize_text(dynamic_document.get("file_format")).upper(),
            }
        )
    return result


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
    document_snapshots = payload.get("documents") or []
    dynamic_documents = {
        normalize_text(document.get("code")): document
        for document in document_snapshots
        if isinstance(document, dict) and normalize_text(document.get("code"))
    }
    final_folder = build_output_path(output_root, snapshot)
    final_folder.mkdir(parents=True, exist_ok=True)
    hwpx = hwpx or HwpxAutomation()
    excel = excel or ExcelAutomation()
    results: list[dict[str, Any]] = []
    job_id = str(job["id"])

    LOGGER.info(
        "작업 시작 id=%s code=%s business=%s year=%s period=%s documents=%s email=%s phone=%s output=%s",
        job.get("id"), snapshot.get("business_code"), snapshot.get("business_name"),
        snapshot.get("measurement_year"), snapshot.get("measurement_period"), selected,
        mask_email(snapshot.get("manager_email")), mask_phone(snapshot.get("manager_contact")), final_folder,
    )

    if is_job_cancellation_requested(client, job_id):
        results.extend(
            cancelled_document_result(document_type, dynamic_documents)
            for document_type in selected
        )
        return "CANCELLED", results, DOCUMENT_GENERATION_CANCELLED_MESSAGE

    with tempfile.TemporaryDirectory(prefix="measurement-doc-") as temporary:
        temporary_root = Path(temporary)
        for document_index, document_type in enumerate(selected):
            result: dict[str, Any] = {"document_type": document_type, "status": "FAILED"}
            dynamic_document = dynamic_documents.get(document_type)
            if dynamic_document:
                result.update(
                    {
                        "document_definition_id": dynamic_document.get(
                            "document_definition_id"
                        ),
                        "document_name": dynamic_document.get("name"),
                        "file_format": normalize_text(
                            dynamic_document.get("file_format")
                        ).upper(),
                    }
                )
            try:
                raise_if_job_cancellation_requested(client, job_id)
                if dynamic_document:
                    template = dynamic_document.get("template") or {}
                    file_format = result["file_format"]
                    extension = FILE_FORMAT_EXTENSIONS.get(file_format)
                    if not extension or not template:
                        raise RuntimeError("작업에 고정된 문서 정의 또는 템플릿 정보가 없습니다.")
                    if (
                        normalize_text(template.get("extension")).lower()
                        and normalize_text(template.get("extension")).lower() != extension
                    ):
                        raise RuntimeError("문서 형식과 템플릿 확장자가 일치하지 않습니다.")

                    template_file = temporary_root / (
                        f"template-{sanitize_windows_filename(document_type, 'document')}{extension}"
                    )
                    client.download_template(
                        job_id, str(template["template_id"]), template_file
                    )
                    raise_if_job_cancellation_requested(client, job_id)
                    verify_download(template_file, template)
                    working_file = temporary_root / build_filename_from_definition(
                        dynamic_document, snapshot
                    )
                    shutil.copy2(template_file, working_file)
                    raw_mappings = dynamic_document.get("mappings") or []
                    if not isinstance(raw_mappings, list):
                        raise RuntimeError("작업에 고정된 입력 매핑 형식이 올바르지 않습니다.")
                    resolved_mappings = resolve_mapping_values(
                        raw_mappings,
                        snapshot,
                        normalize_text(dynamic_document.get("name")) or document_type,
                    )

                    raise_if_job_cancellation_requested(client, job_id)
                    if file_format == "HWPX":
                        if not resolved_mappings:
                            raise RuntimeError("HWPX 입력 매핑이 없습니다.")
                        if any(
                            mapping.get("target_type") != "HWPX_FIELD"
                            for mapping in resolved_mappings
                        ):
                            raise RuntimeError("HWPX 문서에 Excel 셀 매핑이 포함되어 있습니다.")
                        target_values = {
                            normalize_text(mapping.get("target_address")): normalize_text(
                                mapping.get("value")
                            )
                            for mapping in resolved_mappings
                            if normalize_text(mapping.get("value"))
                        }
                        # 설정한 누름틀은 모두 템플릿에 존재해야 한다. required는
                        # 누름틀 존재 여부가 아니라 입력값의 필수 여부에만 사용한다.
                        required_targets = [
                            normalize_text(mapping.get("target_address"))
                            for mapping in resolved_mappings
                        ]
                        hwpx.fill(working_file, target_values, required_targets)
                    else:
                        if any(
                            mapping.get("target_type") != "EXCEL_CELL"
                            for mapping in resolved_mappings
                        ):
                            raise RuntimeError("Excel 문서에 HWPX 누름틀 매핑이 포함되어 있습니다.")
                        if hasattr(excel, "fill_mappings"):
                            excel.fill_mappings(working_file, resolved_mappings)
                        else:
                            excel.fill(
                                working_file,
                                {
                                    f"{mapping.get('target_sheet')}!{mapping.get('target_address')}": mapping.get(
                                        "value"
                                    )
                                    for mapping in resolved_mappings
                                },
                            )

                    raise_if_job_cancellation_requested(client, job_id)
                    if not working_file.exists() or working_file.stat().st_size <= 0:
                        raise RuntimeError("저장 검증에 실패했습니다.")
                    raise_if_job_cancellation_requested(client, job_id)
                    destination = publish_file(
                        working_file,
                        final_folder / working_file.name,
                        overwrite=document_type in PRELIMINARY_SURVEY_OVERWRITE_CODES,
                    )
                    result.update(
                        {
                            "input_fields": [
                                mapping.get("source_field") for mapping in resolved_mappings
                            ],
                            "status": "COMPLETED",
                            "filename": destination.name,
                            "path": str(destination),
                        }
                    )
                    results.append(result)
                    checkpoint_supported, cancellation_requested = checkpoint_job_progress(
                        client, job_id, results
                    )
                    if (
                        document_index + 1 < len(selected)
                        and (
                            cancellation_requested
                            if checkpoint_supported
                            else is_job_cancellation_requested(client, job_id)
                        )
                    ):
                        results.extend(
                            cancelled_document_result(remaining, dynamic_documents)
                            for remaining in selected[document_index + 1 :]
                        )
                        break
                    continue

                # 배포 전에 생성된 기존 payload 작업은 기존 3종 고정 규칙으로 처리한다.
                definition = DOCUMENT_TYPES.get(document_type)
                template = templates.get(document_type)
                if not definition or not template:
                    raise RuntimeError("작업에 고정된 템플릿 정보가 없습니다.")
                extension = definition["extension"]
                template_file = temporary_root / f"template-{document_type}{extension}"
                client.download_template(job_id, str(template["template_id"]), template_file)
                raise_if_job_cancellation_requested(client, job_id)
                verify_download(template_file, template)
                working_file = temporary_root / build_filename(document_type, snapshot)
                shutil.copy2(template_file, working_file)

                raise_if_job_cancellation_requested(client, job_id)
                if extension == ".hwpx":
                    fields = list(definition["fields"])
                    hwpx.fill(working_file, snapshot, fields)
                    result["input_fields"] = fields
                else:
                    excel.fill(working_file, snapshot)
                    result["input_fields"] = list(XLSM_CELLS.values())

                raise_if_job_cancellation_requested(client, job_id)
                if not working_file.exists() or working_file.stat().st_size <= 0:
                    raise RuntimeError("저장 검증에 실패했습니다.")
                raise_if_job_cancellation_requested(client, job_id)
                destination = publish_file(
                    working_file,
                    final_folder / working_file.name,
                    overwrite=document_type in PRELIMINARY_SURVEY_OVERWRITE_CODES,
                )
                result.update({"status": "COMPLETED", "filename": destination.name, "path": str(destination)})
            except DocumentGenerationCancelled:
                result.update(
                    {
                        "status": "CANCELLED",
                        "error": DOCUMENT_GENERATION_CANCELLED_MESSAGE,
                    }
                )
                results.append(result)
                results.extend(
                    cancelled_document_result(remaining, dynamic_documents)
                    for remaining in selected[document_index + 1 :]
                )
                break
            except Exception as error:
                result["error"] = str(error)
                LOGGER.exception("문서 생성 실패 job=%s type=%s", job.get("id"), document_type)
            results.append(result)
            checkpoint_supported, cancellation_requested = (
                checkpoint_job_progress(client, job_id, results)
                if result["status"] == "COMPLETED"
                else (False, False)
            )
            if (
                result["status"] == "COMPLETED"
                and document_index + 1 < len(selected)
                and (
                    cancellation_requested
                    if checkpoint_supported
                    else is_job_cancellation_requested(client, job_id)
                )
            ):
                results.extend(
                    cancelled_document_result(remaining, dynamic_documents)
                    for remaining in selected[document_index + 1 :]
                )
                break

    completed = sum(result["status"] == "COMPLETED" for result in results)
    cancelled = any(result["status"] == "CANCELLED" for result in results)
    status = (
        "COMPLETED"
        if completed == len(results) and results
        else "PARTIAL_SUCCESS"
        if completed
        else "CANCELLED"
        if cancelled
        else "FAILED"
    )
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

        recover = getattr(client, "recover_cancelled_jobs", None)
        if callable(recover):
            recover()
        job = client.claim()
        if not job:
            return None
        job_id = str(job["id"])
        with JobLeaseHeartbeat(client, job_id):
            status, results, error_message = process_job(job, client, output_root)
            client.complete(job_id, status, results, error_message)
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
        effective_recovery_poll_seconds,
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

    if not once:
        worker_mutex = WindowsWorkerMutex()
        try:
            if not worker_mutex.acquire():
                LOGGER.error("이미 실행 중인 문서 Worker가 있어 중복 프로세스를 종료합니다.")
                return 0
        except Exception:
            LOGGER.exception("문서 Worker 중복 실행 잠금 초기화에 실패했습니다.")
            return 2
        atexit.register(worker_mutex.release)

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
        configured_recovery_poll_seconds = int(
            os.environ.get("DOCUMENT_WORKER_RECOVERY_POLL_SECONDS", "21600")
        )
        recovery_poll_seconds = effective_recovery_poll_seconds(
            str(configured_recovery_poll_seconds)
        )
    except ValueError:
        LOGGER.error("DOCUMENT_WORKER_RECOVERY_POLL_SECONDS는 정수여야 합니다.")
        return 2
    if configured_recovery_poll_seconds < recovery_poll_seconds:
        LOGGER.warning(
            "DOCUMENT_WORKER_RECOVERY_POLL_SECONDS=%s는 최소 안전 확인 주기보다 짧아 %s초로 보정합니다.",
            configured_recovery_poll_seconds,
            recovery_poll_seconds,
        )

    realtime_enabled = env_flag(os.environ.get("DOCUMENT_WORKER_REALTIME_ENABLED"), True)
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    realtime_key = (
        os.environ.get("SUPABASE_REALTIME_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    )
    if realtime_enabled and (not supabase_url or not realtime_key):
        LOGGER.error(
            "Realtime 환경변수가 부족하여 6시간 PENDING queue 안전 확인 전용으로 실행합니다. "
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
    LOGGER.info("PENDING queue 안전 확인 주기: 6시간 (%s초)", recovery_poll_seconds)

    recovery_monitor = CancelledJobRecoveryMonitor(client)
    recovery_monitor.start()
    coordinator = ClaimCoordinator(process_next)
    runtime = DocumentWorkerRuntime(coordinator, settings)
    try:
        asyncio.run(runtime.run())
    except KeyboardInterrupt:
        LOGGER.info("종료 신호 수신. Realtime과 현재 작업을 정리합니다.")
    finally:
        recovery_monitor.stop()
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(description="신규 사업장 문서 생성 Windows Worker")
    parser.add_argument("--once", action="store_true", help="작업을 한 번 확인한 뒤 종료")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [DocumentWorker] %(levelname)s %(message)s")
    return run_worker(arguments.once)


if __name__ == "__main__":
    raise SystemExit(main())
