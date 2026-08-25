import JSZip from "jszip";
import { DOCUMENT_SOURCE_FIELDS } from "./definitions";
import {
  normalizeHwpxPlaceholderLabel,
  resolveHwpxPlaceholderAlias,
} from "./hwpx-placeholder-aliases";

const HWPX_MIMETYPE = "application/hwp+zip";
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 64 * 1024 * 1024;
const SOURCE_FIELDS = new Set<string>(DOCUMENT_SOURCE_FIELDS.map(({ value }) => value));

export type HwpxMatchType = "exact" | "alias" | null;

export type HwpxPlaceholderOccurrence = {
  section: number;
  section_path: string;
  position: string;
  default_value: string;
  nested: boolean;
  conflict: boolean;
};

export type HwpxPlaceholderAnalysis = {
  placeholder_name: string;
  display_name: string;
  mapped_db_field: string | null;
  required: boolean;
  default_value: string;
  match_type: HwpxMatchType;
  occurrence_count: number;
  sections: number[];
  occurrences: HwpxPlaceholderOccurrence[];
  warnings: string[];
};

export type HwpxAnalysisResult = {
  placeholders: HwpxPlaceholderAnalysis[];
  summary: {
    discovered: number;
    unique: number;
    auto_matched: number;
    unmatched: number;
    requires_confirmation: number;
    duplicate_names: number;
    warnings: number;
  };
};

export class HwpxAnalysisError extends Error {
  constructor(
    public readonly code:
      | "INVALID_HWPX"
      | "CORRUPT_ZIP"
      | "XML_PARSE_FAILED"
      | "NO_PLACEHOLDERS"
      | "HWPX_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "HwpxAnalysisError";
  }
}

type XmlElement = {
  qName: string;
  localName: string;
  attributes: Record<string, string>;
  startTagStart: number;
  startTagEnd: number;
  endTagStart: number;
  endTagEnd: number;
  parent: XmlElement | null;
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const numeric = entity.toLowerCase().startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const matcher = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(matcher))
    attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  return attributes;
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index + 1;
  }
  return -1;
}

function parseXmlElements(xml: string): XmlElement[] {
  const elements: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) break;
    if (xml.startsWith("<!--", start)) {
      const end = xml.indexOf("-->", start + 4);
      if (end < 0) throw new Error("닫히지 않은 XML 주석입니다.");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      const end = xml.indexOf("]]>", start + 9);
      if (end < 0) throw new Error("닫히지 않은 CDATA입니다.");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", start)) {
      const end = xml.indexOf("?>", start + 2);
      if (end < 0) throw new Error("닫히지 않은 XML 선언입니다.");
      cursor = end + 2;
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(xml.slice(start, start + 10)))
      throw new Error("DOCTYPE이 포함된 XML은 분석할 수 없습니다.");

    const tagEnd = findTagEnd(xml, start);
    if (tagEnd < 0) throw new Error("닫히지 않은 XML 태그입니다.");
    const raw = xml.slice(start + 1, tagEnd - 1).trim();
    if (!raw || raw.startsWith("!")) {
      cursor = tagEnd;
      continue;
    }
    if (raw.startsWith("/")) {
      const qName = raw.slice(1).trim();
      const opened = stack.pop();
      if (!opened || opened.qName !== qName)
        throw new Error(`XML 닫는 태그가 일치하지 않습니다: ${qName}`);
      opened.endTagStart = start;
      opened.endTagEnd = tagEnd;
      cursor = tagEnd;
      continue;
    }

    const selfClosing = /\/\s*$/.test(raw);
    const content = selfClosing ? raw.replace(/\/\s*$/, "").trim() : raw;
    const nameMatch = content.match(/^([^\s/>]+)/);
    if (!nameMatch) throw new Error("XML 요소 이름을 읽을 수 없습니다.");
    const qName = nameMatch[1];
    const element: XmlElement = {
      qName,
      localName: qName.includes(":") ? qName.slice(qName.lastIndexOf(":") + 1) : qName,
      attributes: parseAttributes(content.slice(qName.length)),
      startTagStart: start,
      startTagEnd: tagEnd,
      endTagStart: selfClosing ? start : -1,
      endTagEnd: selfClosing ? tagEnd : -1,
      parent: stack.at(-1) || null,
    };
    elements.push(element);
    if (!selfClosing) stack.push(element);
    cursor = tagEnd;
  }

  if (stack.length > 0) throw new Error(`닫히지 않은 XML 요소입니다: ${stack.at(-1)?.qName}`);
  if (elements.length === 0) throw new Error("XML 요소가 없습니다.");
  return elements;
}

function elementInnerText(xml: string, element: XmlElement): string {
  if (element.endTagStart < element.startTagEnd) return "";
  return decodeXmlEntities(
    xml
      .slice(element.startTagEnd, element.endTagStart)
      .replace(/<(?:[\w.-]+:)?(?:lineBreak|br)\b[^>]*\/?>/gi, "\n")
      .replace(/<(?:[\w.-]+:)?tab\b[^>]*\/?>/gi, "\t")
      .replace(/<[^>]+>/g, "")
  );
}

function extractDisplayName(xml: string, begin: XmlElement, elements: XmlElement[]): string {
  const descendants = elements.filter(
    (element) => element.startTagStart > begin.startTagStart && element.endTagEnd <= begin.endTagEnd
  );
  const command = descendants.find(
    (element) =>
      element.localName === "stringParam" && element.attributes.name?.toLowerCase() === "command"
  );
  const commandText = command ? elementInnerText(xml, command) : "";
  const direction = commandText.match(/Direction:wstring:(\d+):/i);
  if (direction) {
    const start = (direction.index || 0) + direction[0].length;
    const length = Number(direction[1]);
    if (Number.isInteger(length) && length >= 0 && length <= 1000)
      return commandText.slice(start, start + length).trim();
  }
  for (const parameterName of ["description", "displayName", "placeholder", "direction"]) {
    const parameter = descendants.find(
      (element) =>
        element.localName === "stringParam" &&
        element.attributes.name?.toLowerCase() === parameterName.toLowerCase()
    );
    if (parameter) {
      const value = elementInnerText(xml, parameter).trim();
      if (value) return value;
    }
  }
  return "";
}

function contentStart(begin: XmlElement): number {
  return begin.parent?.localName === "ctrl" ? begin.parent.endTagEnd : begin.endTagEnd;
}

function contentEnd(end: XmlElement): number {
  return end.parent?.localName === "ctrl" ? end.parent.startTagStart : end.startTagStart;
}

type RawOccurrence = HwpxPlaceholderOccurrence & {
  placeholder_name: string;
  display_name: string;
};

function analyzeSection(xml: string, sectionPath: string, section: number): RawOccurrence[] {
  let elements: XmlElement[];
  try {
    elements = parseXmlElements(xml);
  } catch (error) {
    throw new HwpxAnalysisError(
      "XML_PARSE_FAILED",
      `${sectionPath} XML 파싱에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
    );
  }
  const begins = elements.filter(
    (element) =>
      element.localName === "fieldBegin" && element.attributes.type?.toUpperCase() === "CLICK_HERE"
  );
  const ends = elements.filter((element) => element.localName === "fieldEnd");

  const raw = begins.map((begin, index) => {
    const id = begin.attributes.id;
    const matchingEnd = ends.find(
      (end) => end.startTagStart > begin.endTagEnd && (id ? end.attributes.beginIDRef === id : true)
    );
    const start = contentStart(begin);
    const end = matchingEnd ? contentEnd(matchingEnd) : start;
    const conflict = !matchingEnd || end < start;
    return {
      placeholder_name: normalizeHwpxPlaceholderLabel(begin.attributes.name),
      display_name: normalizeHwpxPlaceholderLabel(extractDisplayName(xml, begin, elements)),
      section,
      section_path: sectionPath,
      position: `${sectionPath}#${index + 1}`,
      default_value: conflict
        ? ""
        : elementInnerText(xml, {
            ...begin,
            startTagEnd: start,
            endTagStart: end,
          }).trim(),
      nested: false,
      conflict,
      start,
      end,
    };
  });

  for (let left = 0; left < raw.length; left += 1) {
    for (let right = left + 1; right < raw.length; right += 1) {
      const a = raw[left];
      const b = raw[right];
      if (a.start < b.end && b.start < a.end) {
        a.nested = true;
        b.nested = true;
      }
    }
  }
  return raw.map(({ start: _start, end: _end, ...occurrence }) => occurrence);
}

function matchPlaceholder(name: string, displayName: string) {
  for (const candidate of [name, displayName]) {
    if (SOURCE_FIELDS.has(candidate))
      return { mapped_db_field: candidate, match_type: "exact" as const };
  }
  for (const candidate of [name, displayName]) {
    const alias = resolveHwpxPlaceholderAlias(candidate);
    if (alias && SOURCE_FIELDS.has(alias))
      return { mapped_db_field: alias, match_type: "alias" as const };
  }
  return { mapped_db_field: null, match_type: null };
}

export async function analyzeHwpxPlaceholders(
  bytes: Buffer | Uint8Array
): Promise<HwpxAnalysisResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new HwpxAnalysisError("CORRUPT_ZIP", "HWPX ZIP 파일이 손상되어 열 수 없습니다.");
  }

  const mimetypeEntry = zip.file("mimetype");
  const hasPackage = Boolean(zip.file("Contents/content.hpf"));
  if (mimetypeEntry) {
    const mimetype = (await mimetypeEntry.async("text")).trim();
    if (mimetype !== HWPX_MIMETYPE)
      throw new HwpxAnalysisError("INVALID_HWPX", "선택한 파일은 HWPX 형식이 아닙니다.");
  } else if (!hasPackage) {
    throw new HwpxAnalysisError("INVALID_HWPX", "HWPX 패키지 정보를 찾을 수 없습니다.");
  }

  const sectionPaths = Object.keys(zip.files)
    .filter((path) => /^Contents\/section\d+\.xml$/i.test(path) && !zip.files[path].dir)
    .sort((left, right) => {
      const leftNumber = Number(left.match(/section(\d+)/i)?.[1] || 0);
      const rightNumber = Number(right.match(/section(\d+)/i)?.[1] || 0);
      return leftNumber - rightNumber;
    });
  if (sectionPaths.length === 0)
    throw new HwpxAnalysisError("INVALID_HWPX", "HWPX 본문 XML을 찾을 수 없습니다.");

  const occurrences: RawOccurrence[] = [];
  let totalXmlBytes = 0;
  for (const sectionPath of sectionPaths) {
    const declaredSize = Number(
      (
        zip.files[sectionPath] as JSZip.JSZipObject & {
          _data?: { uncompressedSize?: number };
        }
      )._data?.uncompressedSize
    );
    if (Number.isFinite(declaredSize)) {
      totalXmlBytes += declaredSize;
      if (declaredSize > MAX_XML_BYTES || totalXmlBytes > MAX_TOTAL_XML_BYTES)
        throw new HwpxAnalysisError(
          "HWPX_TOO_LARGE",
          "HWPX 본문 XML 크기가 분석 제한을 초과했습니다."
        );
    }
    let xml: string;
    try {
      xml = await zip.file(sectionPath)!.async("text");
    } catch {
      throw new HwpxAnalysisError("CORRUPT_ZIP", `${sectionPath} 압축을 해제할 수 없습니다.`);
    }
    const xmlBytes = Buffer.byteLength(xml, "utf8");
    if (!Number.isFinite(declaredSize)) totalXmlBytes += xmlBytes;
    if (xmlBytes > MAX_XML_BYTES || totalXmlBytes > MAX_TOTAL_XML_BYTES)
      throw new HwpxAnalysisError(
        "HWPX_TOO_LARGE",
        "HWPX 본문 XML 크기가 분석 제한을 초과했습니다."
      );
    const section = Number(sectionPath.match(/section(\d+)/i)?.[1] || 0);
    occurrences.push(...analyzeSection(xml, sectionPath, section));
  }

  if (occurrences.length === 0)
    throw new HwpxAnalysisError("NO_PLACEHOLDERS", "HWPX에서 누름틀을 찾지 못했습니다.");

  const grouped = new Map<string, RawOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = occurrence.placeholder_name || `__unnamed__:${occurrence.position}`;
    grouped.set(key, [...(grouped.get(key) || []), occurrence]);
  }
  const placeholders = [...grouped.values()].map((group) => {
    const first = group[0];
    const match = matchPlaceholder(first.placeholder_name, first.display_name);
    const warnings: string[] = [];
    if (!first.placeholder_name) warnings.push("내부 이름이 없는 누름틀입니다.");
    if (group.length > 1) warnings.push(`동일 누름틀 이름이 ${group.length}회 등장합니다.`);
    if (group.some(({ nested }) => nested)) warnings.push("누름틀이 중첩되어 있습니다.");
    if (group.some(({ conflict }) => conflict))
      warnings.push("누름틀 시작·종료 위치가 충돌하거나 짝이 맞지 않습니다.");
    if (new Set(group.map(({ default_value }) => default_value)).size > 1)
      warnings.push("동일 이름 누름틀의 기본값이 서로 다릅니다.");
    return {
      placeholder_name: first.placeholder_name,
      display_name: first.display_name || first.placeholder_name,
      ...match,
      required: false,
      // 원본의 표시문구는 입력 안내용 placeholder이며 업무 기본값이 아니다.
      // 실제 default_value는 관리자가 매핑 화면에서 명시적으로 입력한 값만 저장한다.
      default_value: "",
      occurrence_count: group.length,
      sections: [...new Set(group.map(({ section }) => section))],
      occurrences: group.map(
        ({ placeholder_name: _name, display_name: _displayName, ...occurrence }) => occurrence
      ),
      warnings,
    } satisfies HwpxPlaceholderAnalysis;
  });
  const autoMatched = placeholders.filter(({ mapped_db_field }) => mapped_db_field).length;
  return {
    placeholders,
    summary: {
      discovered: occurrences.length,
      unique: placeholders.length,
      auto_matched: autoMatched,
      unmatched: placeholders.length - autoMatched,
      requires_confirmation: placeholders.filter(
        ({ mapped_db_field, warnings }) => !mapped_db_field || warnings.length > 0
      ).length,
      duplicate_names: placeholders.filter(({ occurrence_count }) => occurrence_count > 1).length,
      warnings: placeholders.filter(({ warnings }) => warnings.length > 0).length,
    },
  };
}
