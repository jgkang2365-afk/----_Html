from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from document_worker import ExcelAutomation, HwpxAutomation, build_filename, build_output_path, process_job


class LocalTemplateClient:
    def __init__(self, templates: dict[str, Path]) -> None:
        self.templates = templates

    def download_template(self, job_id: str, template_id: str, destination: Path) -> None:
        destination.write_bytes(self.templates[template_id].read_bytes())


def main() -> int:
    parser = argparse.ArgumentParser(description="H0507 실제 템플릿 Windows COM 통합 검증")
    parser.add_argument("--general", type=Path, required=True)
    parser.add_argument("--field", type=Path, required=True)
    parser.add_argument("--xlsm", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, default=None)
    arguments = parser.parse_args()
    templates = {
        "GENERAL_PRELIMINARY_SURVEY": arguments.general,
        "FIELD_PRELIMINARY_SURVEY": arguments.field,
        "MEASUREMENT_PLAN_XLSM": arguments.xlsm,
    }
    for path in templates.values():
        if not path.exists() or path.stat().st_size <= 0:
            raise FileNotFoundError(path)

    temporary = tempfile.TemporaryDirectory(prefix="h0507-doc-worker-") if arguments.output_root is None else None
    output_root = arguments.output_root or Path(temporary.name)
    snapshot = {
        "measurement_year": "2026", "measurement_period": "하반기", "business_id": "507",
        "business_code": "H0507", "business_name": "H0507 통합검증 사업장",
        "representative_name": "테스트대표", "address": "충청남도 천안시",
        "business_category": "제조", "phone": "041-000-0000", "main_product": "검증제품",
        "fax": "041-000-0001", "total_employees": "10", "manager_name": "테스트담당",
        "manager_email": "manager@example.com", "manager_mobile": "010-1234-5678",
        "manager_phone": "041-123-4567", "invoice_email": "invoice@example.com",
        "business_number": "1234567890", "industrial_accident_number": "01234567890",
        "preliminary_surveyor": "",
    }
    template_payload = {
        document_type: {
            "template_id": document_type.lower(), "version": 1, "storage_path": str(path),
            "original_filename": path.name, "size_bytes": path.stat().st_size,
            "extension": path.suffix.lower(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for document_type, path in templates.items()
    }
    job = {
        "id": "h0507-integration", "selected_documents": list(templates),
        "payload": {"snapshot": snapshot, "templates": template_payload, "selected_documents": list(templates)},
    }
    client = LocalTemplateClient({document_type.lower(): path for document_type, path in templates.items()})
    status, results, error = process_job(job, client, output_root, HwpxAutomation(), ExcelAutomation())
    report = {"status": status, "error": error, "output_path": str(build_output_path(output_root, snapshot)), "results": results}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    for document_type in templates:
        print(f"EXPECTED {document_type}: {build_filename(document_type, snapshot)}")
    if temporary:
        print("임시 출력은 종료 시 정리됩니다. 실제 확인은 --output-root를 지정하세요.")
        temporary.cleanup()
    return 0 if status == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
