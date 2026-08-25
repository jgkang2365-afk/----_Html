from __future__ import annotations

import html
import os
import re
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path


_SECTION_NAME = re.compile(r"^Contents/section[^/]*[.]xml$")
_XML_TAG = re.compile(
    r"<(?P<close>/)?(?P<name>[A-Za-z_][A-Za-z0-9_.:-]*)"
    r"(?P<body>(?:[^>\"']|\"[^\"]*\"|'[^']*')*)>",
    re.DOTALL,
)
_XML_ATTRIBUTE = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*"
    r"(?P<quote>[\"'])(?P<value>.*?)(?P=quote)",
    re.DOTALL,
)


@dataclass
class _ElementSpan:
    name: str
    local_name: str
    attributes: dict[str, str]
    start: int
    open_end: int
    end: int | None
    close_start: int | None
    parent: int | None


@dataclass(frozen=True)
class _FieldSpan:
    name: str
    field_id: str
    dirty: str
    has_meta_tag: bool
    start: int
    end: int
    char_pr_ids: frozenset[str]


@dataclass(frozen=True)
class BlankClickHereSnapshot:
    entries: dict[str, bytes]
    field_names: frozenset[str]


def _parse_elements(xml: str) -> list[_ElementSpan]:
    elements: list[_ElementSpan] = []
    stack: list[int] = []
    for match in _XML_TAG.finditer(xml):
        name = match.group("name")
        if match.group("close"):
            if not stack or elements[stack[-1]].name != name:
                raise ValueError(f"HWPX XML 닫는 태그가 일치하지 않습니다: {name}")
            index = stack.pop()
            elements[index].close_start = match.start()
            elements[index].end = match.end()
            continue

        body = match.group("body")
        self_closing = body.rstrip().endswith("/")
        attributes = {
            attribute.group("name"): html.unescape(attribute.group("value"))
            for attribute in _XML_ATTRIBUTE.finditer(body)
        }
        element = _ElementSpan(
            name=name,
            local_name=name.split(":")[-1],
            attributes=attributes,
            start=match.start(),
            open_end=match.end(),
            end=match.end() if self_closing else None,
            close_start=match.start() if self_closing else None,
            parent=stack[-1] if stack else None,
        )
        elements.append(element)
        if not self_closing:
            stack.append(len(elements) - 1)
    if stack:
        raise ValueError("HWPX XML에 닫히지 않은 태그가 있습니다.")
    return elements


def _ancestor(
    elements: list[_ElementSpan], index: int, local_name: str
) -> _ElementSpan | None:
    current: int | None = index
    while current is not None:
        element = elements[current]
        if element.local_name == local_name:
            return element
        current = element.parent
    return None


def _field_spans(xml: str) -> list[_FieldSpan]:
    elements = _parse_elements(xml)
    ends_by_id = {
        element.attributes.get("beginIDRef", ""): index
        for index, element in enumerate(elements)
        if element.local_name == "fieldEnd"
    }
    fields: list[_FieldSpan] = []
    for index, begin in enumerate(elements):
        if begin.local_name != "fieldBegin" or begin.attributes.get("type") != "CLICK_HERE":
            continue
        field_id = begin.attributes.get("id", "")
        end_index = ends_by_id.get(field_id)
        begin_run = _ancestor(elements, index, "run")
        end_run = _ancestor(elements, end_index, "run") if end_index is not None else None
        if begin_run is None or end_run is None or begin_run.end is None or end_run.end is None:
            raise ValueError(
                f"CLICK_HERE 누름틀 범위를 찾지 못했습니다: {begin.attributes.get('name', '')}"
            )
        start = min(begin_run.start, end_run.start)
        end = max(begin_run.end, end_run.end)
        fragment = xml[start:end]
        fields.append(
            _FieldSpan(
                name=begin.attributes.get("name", ""),
                field_id=field_id,
                dirty=begin.attributes.get("dirty", ""),
                has_meta_tag="metaTag" in begin.attributes,
                start=start,
                end=end,
                char_pr_ids=frozenset(
                    re.findall(r'\bcharPrIDRef\s*=\s*["\']([^"\']+)["\']', fragment)
                ),
            )
        )
    return fields


def _read_xml_entries(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        section_names = [name for name in names if _SECTION_NAME.match(name)]
        if "Contents/header.xml" not in names or not section_names:
            raise ValueError("HWPX header 또는 section XML이 없습니다.")
        return {
            name: archive.read(name)
            for name in ["Contents/header.xml", *section_names]
        }


def capture_blank_click_here_fields(
    path: Path, field_names: set[str] | frozenset[str]
) -> BlankClickHereSnapshot:
    normalized = frozenset(name.strip() for name in field_names if name.strip())
    return BlankClickHereSnapshot(_read_xml_entries(path), normalized)


def _replace_attribute(opening_tag: str, name: str, value: str) -> str:
    pattern = re.compile(
        rf"(?P<prefix>\b{re.escape(name)}\s*=\s*)(?P<quote>[\"']).*?(?P=quote)",
        re.DOTALL,
    )
    if not pattern.search(opening_tag):
        raise ValueError(f"HWPX XML 속성이 없습니다: {name}")
    return pattern.sub(
        lambda match: f"{match.group('prefix')}{match.group('quote')}{value}{match.group('quote')}",
        opening_tag,
        count=1,
    )


def _append_source_char_properties(
    source_header: str, generated_header: str, source_ids: set[str]
) -> tuple[str, dict[str, str]]:
    if not source_ids:
        return generated_header, {}
    source_elements = _parse_elements(source_header)
    generated_elements = _parse_elements(generated_header)
    source_char_properties = next(
        element for element in source_elements if element.local_name == "charProperties"
    )
    generated_char_properties = next(
        element for element in generated_elements if element.local_name == "charProperties"
    )
    source_char_pr = {
        element.attributes.get("id", ""): element
        for element in source_elements
        if element.local_name == "charPr"
        and element.parent is not None
        and source_elements[element.parent] is source_char_properties
    }
    generated_char_pr = [
        element
        for element in generated_elements
        if element.local_name == "charPr"
        and element.parent is not None
        and generated_elements[element.parent] is generated_char_properties
    ]
    numeric_ids = [
        int(element.attributes["id"])
        for element in generated_char_pr
        if element.attributes.get("id", "").isdigit()
    ]
    next_id = max(numeric_ids, default=-1) + 1
    id_map: dict[str, str] = {}
    additions: list[str] = []
    for source_id in sorted(source_ids, key=lambda value: (not value.isdigit(), value)):
        source_element = source_char_pr.get(source_id)
        if source_element is None or source_element.end is None:
            raise ValueError(f"원본 HWPX charPr를 찾지 못했습니다: {source_id}")
        new_id = str(next_id)
        next_id += 1
        fragment = source_header[source_element.start : source_element.end]
        opening = fragment[: source_element.open_end - source_element.start]
        additions.append(
            _replace_attribute(opening, "id", new_id)
            + fragment[source_element.open_end - source_element.start :]
        )
        id_map[source_id] = new_id

    if generated_char_properties.close_start is None:
        raise ValueError("HWPX charProperties 닫는 태그가 없습니다.")
    opening = generated_header[
        generated_char_properties.start : generated_char_properties.open_end
    ]
    opening = _replace_attribute(
        opening, "itemCnt", str(len(generated_char_pr) + len(additions))
    )
    edits = [
        (
            generated_char_properties.close_start,
            generated_char_properties.close_start,
            "".join(additions),
        ),
        (
            generated_char_properties.start,
            generated_char_properties.open_end,
            opening,
        ),
    ]
    for start, end, replacement in sorted(edits, reverse=True):
        generated_header = generated_header[:start] + replacement + generated_header[end:]
    return generated_header, id_map


def _remap_char_pr_ids(fragment: str, id_map: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        source_id = match.group("id")
        return f"{match.group('prefix')}{match.group('quote')}{id_map[source_id]}{match.group('quote')}"

    return re.sub(
        r"(?P<prefix>\bcharPrIDRef\s*=\s*)(?P<quote>[\"'])(?P<id>[^\"']+)(?P=quote)",
        replace,
        fragment,
    )


def _plan_section_restoration(
    source_xml: str, generated_xml: str, field_names: frozenset[str]
) -> tuple[list[tuple[int, int, str]], set[str]]:
    source_fields = _field_spans(source_xml)
    generated_fields = _field_spans(generated_xml)
    generated_by_id = {field.field_id: field for field in generated_fields if field.field_id}
    generated_by_name: dict[str, list[_FieldSpan]] = {}
    for field in generated_fields:
        generated_by_name.setdefault(field.name, []).append(field)
    name_indexes: dict[str, int] = {}
    planned: dict[tuple[int, int], tuple[str, frozenset[str]]] = {}
    for source in source_fields:
        if source.name not in field_names:
            continue
        generated = generated_by_id.get(source.field_id)
        if generated is None:
            name_index = name_indexes.get(source.name, 0)
            candidates = generated_by_name.get(source.name, [])
            if name_index >= len(candidates):
                raise ValueError(f"저장 후 CLICK_HERE 누름틀이 사라졌습니다: {source.name}")
            generated = candidates[name_index]
            name_indexes[source.name] = name_index + 1
        source_fragment = source_xml[source.start : source.end]
        generated_fragment = generated_xml[generated.start : generated.end]
        if source_fragment == generated_fragment:
            continue
        for contained in generated_fields:
            if (
                generated.start <= contained.start
                and contained.end <= generated.end
                and contained.name not in field_names
            ):
                raise ValueError(
                    "blank 누름틀과 실제 값 누름틀이 중첩되어 안전하게 복원할 수 없습니다: "
                    f"{source.name} / {contained.name}"
                )
        key = (generated.start, generated.end)
        previous = planned.get(key)
        if previous is not None and previous[0] != source_fragment:
            raise ValueError(f"중첩 CLICK_HERE 누름틀 복원 범위가 충돌합니다: {source.name}")
        planned[key] = (source_fragment, source.char_pr_ids)

    ranges = sorted(planned)
    for (_, previous_end), (current_start, _) in zip(ranges, ranges[1:]):
        if current_start < previous_end:
            raise ValueError("중첩 CLICK_HERE 누름틀 복원 범위가 겹칩니다.")
    char_pr_ids = set().union(*(value[1] for value in planned.values())) if planned else set()
    return [
        (start, end, planned[(start, end)][0]) for start, end in ranges
    ], char_pr_ids


def _rewrite_hwpx(path: Path, replacements: dict[str, bytes]) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(temporary, "w") as target:
            for info in source.infolist():
                target.writestr(info, replacements.get(info.filename, source.read(info.filename)))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def restore_blank_click_here_fields(
    path: Path, snapshot: BlankClickHereSnapshot
) -> None:
    if not snapshot.field_names:
        return
    generated_entries = _read_xml_entries(path)
    section_plans: dict[str, list[tuple[int, int, str]]] = {}
    source_char_pr_ids: set[str] = set()
    for name, source_bytes in snapshot.entries.items():
        if not _SECTION_NAME.match(name):
            continue
        generated_bytes = generated_entries.get(name)
        if generated_bytes is None:
            raise ValueError(f"저장 후 HWPX section이 사라졌습니다: {name}")
        edits, char_pr_ids = _plan_section_restoration(
            source_bytes.decode("utf-8"),
            generated_bytes.decode("utf-8"),
            snapshot.field_names,
        )
        if edits:
            section_plans[name] = edits
            source_char_pr_ids.update(char_pr_ids)
    if not section_plans:
        return

    generated_header, id_map = _append_source_char_properties(
        snapshot.entries["Contents/header.xml"].decode("utf-8"),
        generated_entries["Contents/header.xml"].decode("utf-8"),
        source_char_pr_ids,
    )
    replacements: dict[str, bytes] = {
        "Contents/header.xml": generated_header.encode("utf-8")
    }
    for name, edits in section_plans.items():
        generated_xml = generated_entries[name].decode("utf-8")
        for start, end, source_fragment in sorted(edits, reverse=True):
            generated_xml = (
                generated_xml[:start]
                + _remap_char_pr_ids(source_fragment, id_map)
                + generated_xml[end:]
            )
        replacements[name] = generated_xml.encode("utf-8")
    _rewrite_hwpx(path, replacements)

    final_entries = _read_xml_entries(path)
    for name in section_plans:
        source_fields = [
            field
            for field in _field_spans(snapshot.entries[name].decode("utf-8"))
            if field.name in snapshot.field_names
        ]
        final_fields = _field_spans(final_entries[name].decode("utf-8"))
        restored = [
            field for field in final_fields if field.name in snapshot.field_names
        ]
        if len(restored) != len(source_fields):
            raise ValueError(f"blank CLICK_HERE 복원 검증에 실패했습니다: {name}")
        source_by_id = {field.field_id: field for field in source_fields if field.field_id}
        if any(
            (source := source_by_id.get(field.field_id)) is None
            or field.dirty != source.dirty
            or field.has_meta_tag != source.has_meta_tag
            for field in restored
        ):
            raise ValueError(f"blank CLICK_HERE 미입력 상태 복원에 실패했습니다: {name}")
