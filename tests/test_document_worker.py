import hashlib
import tempfile
import unittest
from pathlib import Path

from document_worker import (
    XLSM_CELLS,
    build_filename,
    build_manager_contact,
    build_output_path,
    format_business_number,
    normalize_measurement_period,
    process_job,
    unique_destination,
)


class LocalClient:
    def __init__(self, sources):
        self.sources = sources

    def download_template(self, job_id, template_id, destination):
        destination.write_bytes(self.sources[template_id].read_bytes())


class MockAutomation:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def fill(self, path, values, fields=None):
        self.calls.append((path, dict(values), list(fields or [])))
        if self.fail:
            raise RuntimeError("mock failure")


class DocumentWorkerTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "measurement_year": "2026", "measurement_period": "하반기",
            "business_code": "H0507", "business_name": "H0507 테스트/사업장",
            "manager_mobile": "010-1234-5678", "manager_phone": "041-123-4567",
            "business_number": "1234567890",
        }

    def test_formatters(self):
        self.assertEqual(normalize_measurement_period("2"), "하반기")
        self.assertEqual(format_business_number("1234567890"), "123-45-67890")
        self.assertEqual(build_manager_contact("", "041-123-4567"), "041-123-4567")
        self.assertEqual(set(XLSM_CELLS), {"B1", "G1", "C2", "F2", "I2"})

    def test_h0507_output_path_and_filename(self):
        path = build_output_path(Path("Z:/data/측정팀/측정보고서"), self.snapshot)
        self.assertIn("(((미확정 사업장)))", str(path))
        self.assertIn("H0507 테스트_사업장", str(path))
        self.assertEqual(build_filename("GENERAL_PRELIMINARY_SURVEY", self.snapshot), "H0507 테스트_사업장(예비조사표-26하).hwpx")

    def test_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / "file.hwpx"
            original.write_bytes(b"original")
            candidate = unique_destination(original)
            self.assertNotEqual(candidate, original)
            self.assertEqual(original.read_bytes(), b"original")

    def test_partial_success_keeps_other_document(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            general = root / "general.hwpx"
            xlsm = root / "plan.xlsm"
            general.write_bytes(b"general-template")
            xlsm.write_bytes(b"xlsm-template")
            sources = {"general": general, "xlsm": xlsm}
            templates = {
                "GENERAL_PRELIMINARY_SURVEY": self._template("general", general),
                "MEASUREMENT_PLAN_XLSM": self._template("xlsm", xlsm),
            }
            job = {"id": "job", "payload": {"snapshot": self.snapshot, "templates": templates, "selected_documents": list(templates)}}
            status, results, error = process_job(job, LocalClient(sources), root / "output", MockAutomation(), MockAutomation(fail=True))
            self.assertEqual(status, "PARTIAL_SUCCESS")
            self.assertEqual([row["status"] for row in results], ["COMPLETED", "FAILED"])
            self.assertIn("mock failure", error)
            self.assertEqual(general.read_bytes(), b"general-template")
            self.assertEqual(xlsm.read_bytes(), b"xlsm-template")

    @staticmethod
    def _template(template_id, path):
        return {
            "template_id": template_id, "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "version": 1,
        }


if __name__ == "__main__":
    unittest.main()
