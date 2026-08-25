import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from document_worker import (
    HwpxAutomation,
    build_filename_from_definition,
    build_output_path,
    process_job,
    resolve_mapping_values,
)


class LocalClient:
    def __init__(self, sources):
        self.sources = sources

    def download_template(self, _job_id, template_id, destination):
        destination.write_bytes(self.sources[template_id].read_bytes())


class HwpxMock:
    def __init__(self):
        self.calls = []

    def fill(self, path, values, required_fields):
        self.calls.append((path, dict(values), list(required_fields)))


class ExcelMock:
    def __init__(self):
        self.calls = []

    def fill_mappings(self, path, mappings):
        self.calls.append((path, list(mappings)))


class DynamicDocumentWorkerTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "measurement_year": "2026",
            "measurement_period": "하반기",
            "business_code": "H0507",
            "business_name": "H0507 테스트/사업장",
            "manager_name": "담당자",
        }

    def test_dynamic_filename_preserves_legacy_and_supports_xlsx(self):
        general = {
            "name": "예비조사표(일반)",
            "file_format": "HWPX",
            "filename_pattern": "{business_name}(예비조사표-{short_year}{short_period})",
        }
        self.assertEqual(
            build_filename_from_definition(general, self.snapshot),
            "H0507 테스트_사업장(예비조사표-26하).hwpx",
        )
        field = {
            "name": "현장 예비조사표",
            "file_format": "HWPX",
            "filename_pattern": "{business_name}(현장 예비조사표-{short_year}{short_period})",
        }
        self.assertEqual(
            build_filename_from_definition(field, self.snapshot),
            "H0507 테스트_사업장(현장 예비조사표-26하).hwpx",
        )
        xlsm = {
            "name": "화학물질입력 및 측정계획",
            "file_format": "XLSM",
            "filename_pattern": "★ {business_name}({short_year}{short_period})_화학물질입력 및 측정계획(V2.0)",
        }
        self.assertEqual(
            build_filename_from_definition(xlsm, self.snapshot),
            "★ H0507 테스트_사업장(26하)_화학물질입력 및 측정계획(V2.0).xlsm",
        )
        xlsx = {
            "name": "안내문",
            "file_format": "XLSX",
            "filename_pattern": "{business_name}({document_name}-{short_year}{short_period})",
        }
        self.assertEqual(
            build_filename_from_definition(xlsx, self.snapshot),
            "H0507 테스트_사업장(안내문-26하).xlsx",
        )

    def test_required_value_uses_snapshot_then_default(self):
        resolved = resolve_mapping_values(
            [
                {
                    "source_field": "manager_name",
                    "target_address": "manager_name",
                    "required": True,
                    "default_value": "기본 담당자",
                    "sort_order": 2,
                },
                {
                    "source_field": "address",
                    "target_address": "address",
                    "required": True,
                    "default_value": "기본 주소",
                    "sort_order": 1,
                },
            ],
            self.snapshot,
            "문서",
        )
        self.assertEqual([row["value"] for row in resolved], ["기본 주소", "담당자"])
        with self.assertRaisesRegex(RuntimeError, "필수 입력값 누락"):
            resolve_mapping_values(
                [
                    {
                        "source_field": "address",
                        "target_address": "address",
                        "required": True,
                    }
                ],
                self.snapshot,
                "문서",
            )

    def test_hwpx_guide_defaults_are_blank_but_admin_default_is_preserved(self):
        mappings = [
            {
                "source_field": source_field,
                "target_type": "HWPX_FIELD",
                "target_address": source_field,
                "default_value": default_value,
                "required": False,
                "sort_order": sort_order,
            }
            for sort_order, (source_field, default_value) in enumerate(
                [
                    ("phone", "전화번호"),
                    ("fax", "팩스"),
                    ("total_employees", "총 근로자수"),
                    ("manager_email", "담당자 메일"),
                ],
                start=1,
            )
        ]
        resolved = resolve_mapping_values(mappings, {}, "예비조사표")
        self.assertEqual([mapping["value"] for mapping in resolved], ["", "", "", ""])

        mappings[0]["default_value"] = "대표번호 없음"
        resolved = resolve_mapping_values(mappings, {}, "예비조사표")
        self.assertEqual(resolved[0]["value"], "대표번호 없음")

    def test_hwpx_automation_does_not_put_blank_fields(self):
        class FakeHwp:
            def __init__(self):
                self.put_calls = []

            def RegisterModule(self, *_args):
                return True

            def Open(self, *_args):
                return True

            def GetFieldList(self, *_args):
                return "phone\x02fax\x02total_employees\x02manager_email\x02business_name"

            def PutFieldText(self, field, value):
                self.put_calls.append((field, value))

            def Save(self, *_args):
                return True

            def Clear(self, *_args):
                return True

            def Quit(self):
                return True

        fake_hwp = FakeHwp()
        client_module = types.ModuleType("win32com.client")
        client_module.Dispatch = lambda *_args: fake_hwp
        package_module = types.ModuleType("win32com")
        package_module.client = client_module
        with patch.dict(
            sys.modules,
            {"win32com": package_module, "win32com.client": client_module},
        ):
            HwpxAutomation().fill(
                Path("test.hwpx"),
                {
                    "phone": "",
                    "fax": "",
                    "total_employees": "",
                    "manager_email": "",
                    "business_name": "테스트 사업장",
                },
                ["phone", "fax", "total_employees", "manager_email", "business_name"],
            )

        self.assertEqual(fake_hwp.put_calls, [("business_name", "테스트 사업장")])
        fake_hwp.put_calls.clear()
        with patch.dict(
            sys.modules,
            {"win32com": package_module, "win32com.client": client_module},
        ):
            HwpxAutomation().fill(
                Path("test.hwpx"),
                {"phone": "대표번호 없음"},
                ["phone"],
            )
        self.assertEqual(fake_hwp.put_calls, [("phone", "대표번호 없음")])

    def test_dynamic_document_failure_is_isolated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            hwpx_template = root / "general.hwpx"
            xlsx_template = root / "missing.xlsx"
            hwpx_template.write_bytes(b"hwpx-template")
            xlsx_template.write_bytes(b"xlsx-template")
            sources = {"hwpx": hwpx_template, "xlsx": xlsx_template}

            def template(template_id, path, extension):
                return {
                    "template_id": template_id,
                    "size_bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "version": 1,
                    "extension": extension,
                }

            documents = [
                {
                    "document_definition_id": "general-id",
                    "code": "GENERAL_PRELIMINARY_SURVEY",
                    "name": "예비조사표(일반)",
                    "file_format": "HWPX",
                    "filename_pattern": "{business_name}(예비조사표-{short_year}{short_period})",
                    "template": template("hwpx", hwpx_template, ".hwpx"),
                    "mappings": [
                        {
                            "source_field": "business_name",
                            "target_type": "HWPX_FIELD",
                            "target_address": "business_name",
                            "required": True,
                            "sort_order": 1,
                        }
                    ],
                },
                {
                    "document_definition_id": "custom-id",
                    "code": "CUSTOM_XLSX",
                    "name": "누락 테스트",
                    "file_format": "XLSX",
                    "filename_pattern": "{business_name}-{document_name}",
                    "template": template("xlsx", xlsx_template, ".xlsx"),
                    "mappings": [
                        {
                            "source_field": "address",
                            "target_type": "EXCEL_CELL",
                            "target_sheet": "기본정보",
                            "target_address": "B2",
                            "required": True,
                            "sort_order": 1,
                        }
                    ],
                },
            ]
            job = {
                "id": "job",
                "payload": {
                    "snapshot": self.snapshot,
                    "documents": documents,
                    "selected_documents": [document["code"] for document in documents],
                },
            }
            hwpx = HwpxMock()
            excel = ExcelMock()
            status, results, error = process_job(
                job, LocalClient(sources), root / "output", hwpx, excel
            )
            self.assertEqual(status, "PARTIAL_SUCCESS")
            self.assertEqual([result["status"] for result in results], ["COMPLETED", "FAILED"])
            self.assertEqual(results[1]["document_definition_id"], "custom-id")
            self.assertEqual(results[1]["document_name"], "누락 테스트")
            self.assertIn("address", error)
            self.assertEqual(len(hwpx.calls), 1)
            self.assertEqual(hwpx.calls[0][2], ["business_name"])
            self.assertEqual(len(excel.calls), 0)

    def test_industrial_shop_uses_existing_dynamic_hwpx_pipeline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            template_path = root / "industrial-shop.hwpx"
            template_path.write_bytes(b"industrial-shop-template")
            template = {
                "template_id": "industrial-shop-template",
                "size_bytes": template_path.stat().st_size,
                "sha256": hashlib.sha256(template_path.read_bytes()).hexdigest(),
                "version": 1,
                "extension": ".hwpx",
            }
            document = {
                "document_definition_id": "industrial-shop-id",
                "code": "INDUSTRIAL_SHOP_PRELIMINARY_SURVEY",
                "name": "예비조사표(공업사)",
                "file_format": "HWPX",
                "filename_pattern": "{business_name}(예비조사표-{short_year}{short_period})",
                "template": template,
                "mappings": [
                    {
                        "source_field": "measurement_year",
                        "target_type": "HWPX_FIELD",
                        "target_address": "measurement_year",
                        "required": True,
                        "sort_order": 1,
                    },
                    {
                        "source_field": "business_name",
                        "target_type": "HWPX_FIELD",
                        "target_address": "business_name",
                        "required": True,
                        "sort_order": 2,
                    },
                    {
                        "source_field": "phone",
                        "target_type": "HWPX_FIELD",
                        "target_address": "phone",
                        "required": False,
                        "sort_order": 3,
                    },
                ],
            }
            job = {
                "id": "industrial-shop-job",
                "payload": {
                    "snapshot": self.snapshot,
                    "documents": [document],
                    "templates": {document["code"]: template},
                    "selected_documents": [document["code"]],
                    "output_path": str(root / "output"),
                },
            }
            hwpx = HwpxMock()
            output_root = root / "output"
            final_folder = build_output_path(output_root, self.snapshot)
            final_folder.mkdir(parents=True)
            existing = final_folder / "H0507 테스트_사업장(예비조사표-26하).hwpx"
            existing.write_bytes(b"old-generated-file")
            status, results, error = process_job(
                job,
                LocalClient({"industrial-shop-template": template_path}),
                output_root,
                hwpx,
                ExcelMock(),
            )

            self.assertEqual(status, "COMPLETED")
            self.assertIsNone(error)
            self.assertEqual(results[0]["document_definition_id"], "industrial-shop-id")
            self.assertEqual(results[0]["document_name"], "예비조사표(공업사)")
            self.assertEqual(
                results[0]["filename"],
                "H0507 테스트_사업장(예비조사표-26하).hwpx",
            )
            self.assertEqual(existing.read_bytes(), b"industrial-shop-template")
            self.assertEqual(
                list(final_folder.glob("H0507 테스트_사업장(예비조사표-26하)_*.hwpx")),
                [],
            )
            self.assertEqual(len(hwpx.calls), 1)
            self.assertEqual(
                hwpx.calls[0][1],
                {"measurement_year": "2026", "business_name": "H0507 테스트/사업장"},
            )
            self.assertEqual(
                hwpx.calls[0][2], ["measurement_year", "business_name", "phone"]
            )


if __name__ == "__main__":
    unittest.main()
