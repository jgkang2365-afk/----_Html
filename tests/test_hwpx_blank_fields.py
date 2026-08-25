import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree

from document_worker import HwpxAutomation, resolve_mapping_values
from hwpx_blank_fields import capture_blank_click_here_fields, restore_blank_click_here_fields


HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
HH = "http://www.hancom.co.kr/hwpml/2011/head"


def header_xml() -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="{HH}"><hh:refList><hh:charProperties itemCnt="3">
<hh:charPr id="0" height="1000" textColor="#000000"/>
<hh:charPr id="1" height="1000" textColor="#000000"><hh:bold/></hh:charPr>
<hh:charPr id="2" height="1000" textColor="#FF0000"><hh:italic/></hh:charPr>
</hh:charProperties></hh:refList></hh:head>'''


def blank_field(field_id: int, name: str, prompt: str, suffix: str = "") -> str:
    return f'''<hp:p id="{field_id}">
<hp:run charPrIDRef="0"><hp:ctrl><hp:fieldBegin id="{field_id}" type="CLICK_HERE" name="{name}" editable="1" dirty="0"><hp:parameters cnt="1"><hp:stringParam name="Direction">{prompt}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl></hp:run>
<hp:run charPrIDRef="2"><hp:t>{prompt}</hp:t></hp:run>
<hp:run charPrIDRef="0"><hp:ctrl><hp:fieldEnd beginIDRef="{field_id}"/></hp:ctrl><hp:t>{suffix}</hp:t></hp:run>
<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>'''


def filled_field(field_id: int, name: str, prompt: str, value: str, suffix: str = "") -> str:
    return f'''<hp:p id="{field_id}"><hp:run charPrIDRef="0"><hp:ctrl><hp:fieldBegin id="{field_id}" type="CLICK_HERE" name="{name}" editable="1" dirty="1" metaTag=""><hp:parameters cnt="1"><hp:stringParam name="Direction">{prompt}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:t>{value}</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="{field_id}"/></hp:ctrl><hp:t>{suffix}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>'''


def section_xml(fields: list[str]) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="{HP}">{''.join(fields)}</hs:sec>'''


def write_hwpx(path: Path, section: str, header: str | None = None) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/hwp+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr("Contents/header.xml", header or header_xml())
        archive.writestr("Contents/section0.xml", section)


def read_entry(path: Path, name: str) -> bytes:
    with zipfile.ZipFile(path) as archive:
        return archive.read(name)


class BlankClickHereRestorationTest(unittest.TestCase):
    def test_restores_blank_fields_without_touching_actual_value_or_static_suffix(self):
        source_fields = [
            blank_field(1, "phone", "전화번호"),
            blank_field(2, "fax", "팩스"),
            blank_field(3, "total_employees", "총 근로자수", "  명"),
            blank_field(4, "manager_email", "담당자 메일"),
            blank_field(5, "business_name", "사업장명"),
        ]
        generated_fields = [
            filled_field(1, "phone", "전화번호", "전화번호"),
            filled_field(2, "fax", "팩스", "팩스"),
            filled_field(3, "total_employees", "총 근로자수", "총 근로자수", "  명"),
            filled_field(4, "manager_email", "담당자 메일", "담당자 메일"),
            filled_field(5, "business_name", "사업장명", "테스트 사업장"),
        ]

        for filename in ("general.hwpx", "industrial.hwpx"):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "source.hwpx"
                generated = root / filename
                write_hwpx(source, section_xml(source_fields))
                snapshot = capture_blank_click_here_fields(
                    source, {"phone", "fax", "total_employees", "manager_email"}
                )
                # HWP 저장 후 사용되지 않은 빨간 안내문 charPr가 제거된 상황을 재현한다.
                generated_header = header_xml().replace(
                    '<hh:charProperties itemCnt="3">', '<hh:charProperties itemCnt="2">'
                ).replace(
                    '<hh:charPr id="2" height="1000" textColor="#FF0000"><hh:italic/></hh:charPr>',
                    "",
                )
                write_hwpx(generated, section_xml(generated_fields), generated_header)

                restore_blank_click_here_fields(generated, snapshot)

                section = ElementTree.fromstring(read_entry(generated, "Contents/section0.xml"))
                header = ElementTree.fromstring(read_entry(generated, "Contents/header.xml"))
                for name in ("phone", "fax", "total_employees", "manager_email"):
                    begin = next(
                        node
                        for node in section.iter(f"{{{HP}}}fieldBegin")
                        if node.get("name") == name
                    )
                    self.assertEqual(begin.get("type"), "CLICK_HERE")
                    self.assertEqual(begin.get("dirty"), "0")
                    self.assertNotIn("metaTag", begin.attrib)

                business = next(
                    node
                    for node in section.iter(f"{{{HP}}}fieldBegin")
                    if node.get("name") == "business_name"
                )
                self.assertEqual(business.get("dirty"), "1")
                self.assertIn("테스트 사업장", "".join(section.itertext()))
                self.assertIn("  명", "".join(section.itertext()))

                prompt_run = next(
                    run
                    for run in section.iter(f"{{{HP}}}run")
                    if any(
                        text.text == "전화번호"
                        for text in run.findall(f"{{{HP}}}t")
                    )
                )
                prompt_char_pr = prompt_run.get("charPrIDRef")
                prompt_style = next(
                    style
                    for style in header.iter(f"{{{HH}}}charPr")
                    if style.get("id") == prompt_char_pr
                )
                self.assertEqual(prompt_style.get("textColor"), "#FF0000")
                self.assertIsNotNone(prompt_style.find(f"{{{HH}}}italic"))
                char_properties = next(header.iter(f"{{{HH}}}charProperties"))
                self.assertEqual(
                    int(char_properties.get("itemCnt", "0")),
                    len(list(char_properties)),
                )

    def test_hwpx_automation_never_calls_put_field_text_for_blank_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "template.hwpx"
            write_hwpx(
                target,
                section_xml(
                    [
                        blank_field(1, "phone", "전화번호"),
                        blank_field(2, "fax", "팩스"),
                        blank_field(3, "total_employees", "총 근로자수", "  명"),
                        blank_field(4, "manager_email", "담당자 메일"),
                        blank_field(5, "business_name", "사업장명"),
                    ]
                ),
            )
            fake = FakeHwp()
            client_module = types.ModuleType("win32com.client")
            client_module.Dispatch = lambda _name: fake
            win32com_module = types.ModuleType("win32com")
            win32com_module.client = client_module

            with patch.dict(
                sys.modules,
                {"win32com": win32com_module, "win32com.client": client_module},
            ):
                HwpxAutomation().fill(
                    target,
                    {"business_name": "테스트 사업장"},
                    ["phone", "fax", "total_employees", "manager_email", "business_name"],
                )

            self.assertEqual(fake.put_calls, [("business_name", "테스트 사업장")])

    def test_real_admin_default_is_written_and_required_target_check_remains(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "template.hwpx"
            write_hwpx(target, section_xml([blank_field(1, "phone", "전화번호")]))
            fake = FakeHwp(["phone"])
            client_module = types.ModuleType("win32com.client")
            client_module.Dispatch = lambda _name: fake
            win32com_module = types.ModuleType("win32com")
            win32com_module.client = client_module
            with patch.dict(
                sys.modules,
                {"win32com": win32com_module, "win32com.client": client_module},
            ):
                HwpxAutomation().fill(
                    target, {"phone": "대표번호 없음"}, ["phone"]
                )
            self.assertEqual(fake.put_calls, [("phone", "대표번호 없음")])

            missing = FakeHwp([])
            client_module.Dispatch = lambda _name: missing
            with patch.dict(
                sys.modules,
                {"win32com": win32com_module, "win32com.client": client_module},
            ), self.assertRaisesRegex(RuntimeError, "누락된 HWPX 누름틀: phone"):
                HwpxAutomation().fill(target, {}, ["phone"])

    def test_guide_defaults_are_blank_but_real_admin_default_is_preserved(self):
        mappings = [
            {"source_field": "phone", "target_type": "HWPX_FIELD", "target_address": "phone", "default_value": "전화번호"},
            {"source_field": "fax", "target_type": "HWPX_FIELD", "target_address": "fax", "default_value": "팩스"},
            {"source_field": "total_employees", "target_type": "HWPX_FIELD", "target_address": "total_employees", "default_value": "총 근로자수"},
            {"source_field": "manager_email", "target_type": "HWPX_FIELD", "target_address": "manager_email", "default_value": "담당자 메일"},
        ]
        resolved = resolve_mapping_values(mappings, {}, "예비조사표")
        self.assertEqual([mapping["value"] for mapping in resolved], ["", "", "", ""])

        real_default = resolve_mapping_values(
            [{**mappings[0], "default_value": "대표번호 없음"}], {}, "예비조사표"
        )
        self.assertEqual(real_default[0]["value"], "대표번호 없음")


class FakeHwp:
    def __init__(self, field_names: list[str] | None = None):
        self.put_calls: list[tuple[str, str]] = []
        self.field_names = (
            field_names
            if field_names is not None
            else [
                "phone",
                "fax",
                "total_employees",
                "manager_email",
                "business_name",
            ]
        )

    def RegisterModule(self, *_args):
        return True

    def Open(self, *_args):
        return True

    def GetFieldList(self, *_args):
        return "\x02".join(self.field_names)

    def PutFieldText(self, name, value):
        self.put_calls.append((name, value))

    def Save(self, *_args):
        return True

    def Clear(self, *_args):
        return True

    def Quit(self):
        return True


if __name__ == "__main__":
    unittest.main()
