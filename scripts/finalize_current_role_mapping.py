from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected block not found")
    return text.replace(old, new, 1)


# Shared current-target participant collector: single-day collaborators / multi-day union.
day_path = Path("lib/business/measurement-day-form.ts")
day = day_path.read_text(encoding="utf-8")
marker = "export interface SerializedMeasurementDays {"
helper = '''/** 측정일지/요약 표시용: 해당 target 전체 측정일의 참여자를 중복 없이 합친다. */
export function collectMeasurementParticipantNames(source: MeasurementDaySource): string[] {
  return normalizeMeasurementCollaborators(
    measurementDayFormsFrom(source).flatMap((day) => day.collaborators),
  );
}

'''
if "export function collectMeasurementParticipantNames" not in day:
    day = replace_once(day, marker, helper + marker, "measurement-day helper")
day_path.write_text(day, encoding="utf-8")

# previous-data: keep all historical/reference values, but expose current role values only from exact target.
prev_path = Path("app/api/journal/previous-data/route.ts")
prev = prev_path.read_text(encoding="utf-8")
prev = replace_once(
    prev,
    'import { checkPermission } from "@/lib/auth/check-permission";',
    'import { checkPermission } from "@/lib/auth/check-permission";\nimport { collectMeasurementParticipantNames } from "@/lib/business/measurement-day-form";',
    "previous-data import",
)
roles_block = '''    const measurementRoles = targetRow
      ? measurementRolesForDisplay({
        dailyStaff: targetRow.daily_staff,
        measurementDate: targetRow.measurement_date,
        measurerId: targetRow.measurer_id,
        collaborators: targetRow.collaborators,
      })
      : { measurementParticipants: [], reportWriterUserId: null };'''
roles_new = roles_block + '''
    const currentMeasurementParticipants = targetRow
      ? collectMeasurementParticipantNames({
        dailyStaff: targetRow.daily_staff,
        measurementDate: targetRow.measurement_date,
        measurerId: targetRow.measurer_id,
        collaborators: targetRow.collaborators,
      })
      : [];'''
prev = replace_once(prev, roles_block, roles_new, "previous-data current participant union")
prev = replace_once(
    prev,
    '        publicSampleCode: v2Assignment?.survey_code,',
    '        publicSampleCode: v2Assignment?.public_sample_code ?? v2Assignment?.survey_code,',
    "previous-data public sample code",
)
prev = replace_once(
    prev,
    '        measurementParticipants: measurementRoles.measurementParticipants,',
    '        measurementParticipants: currentMeasurementParticipants,',
    "previous-data v2 current participants",
)
prev = replace_once(
    prev,
    '        measurementParticipants: legacyDisplaySource.actual_measurer,',
    '        measurementParticipants: targetRow ? currentMeasurementParticipants : legacyDisplaySource.actual_measurer,',
    "previous-data legacy current participants",
)
prev = replace_once(
    prev,
    '        preliminaryDisplay: hasPreliminaryDisplay ? preliminaryDisplay : null,\n      });',
    '        preliminaryDisplay: hasPreliminaryDisplay ? preliminaryDisplay : null,\n        currentMeasurementParticipants: currentMeasurementParticipants.join(", ") || null,\n      });',
    "previous-data empty response",
)
prev = replace_once(
    prev,
    '      preliminaryDisplay: hasPreliminaryDisplay ? preliminaryDisplay : null,\n      referenceData,',
    '      preliminaryDisplay: hasPreliminaryDisplay ? preliminaryDisplay : null,\n      currentMeasurementParticipants: currentMeasurementParticipants.join(", ") || null,\n      referenceData,',
    "previous-data normal response",
)
prev_path.write_text(prev, encoding="utf-8")

# Summary API: role projection is exact code+year+period target; multi-day participants are the union.
summary_api_path = Path("app/api/summary/route.ts")
summary_api = summary_api_path.read_text(encoding="utf-8")
summary_api = replace_once(
    summary_api,
    'import { buildPreliminarySurveyDisplayModel, measurementRolesForDisplay } from "@/lib/preliminary-survey-v2/display-model";',
    'import { buildPreliminarySurveyDisplayModel, measurementRolesForDisplay } from "@/lib/preliminary-survey-v2/display-model";\nimport { collectMeasurementParticipantNames } from "@/lib/business/measurement-day-form";',
    "summary API import",
)
summary_roles = '''      const measurementRoles = displayTarget ? measurementRolesForDisplay({
        dailyStaff: displayTarget.daily_staff,
        measurementDate: displayTarget.measurement_date,
        measurerId: displayTarget.measurer_id,
        collaborators: displayTarget.collaborators,
      }) : { measurementParticipants: [], reportWriterUserId: null };'''
summary_roles_new = summary_roles + '''
      const currentMeasurementParticipants = displayTarget
        ? collectMeasurementParticipantNames({
          dailyStaff: displayTarget.daily_staff,
          measurementDate: displayTarget.measurement_date,
          measurerId: displayTarget.measurer_id,
          collaborators: displayTarget.collaborators,
        })
        : [];'''
summary_api = replace_once(summary_api, summary_roles, summary_roles_new, "summary API current participant union")
summary_api = replace_once(
    summary_api,
    '          measurementParticipants: measurementRoles.measurementParticipants,',
    '          measurementParticipants: currentMeasurementParticipants,',
    "summary API v2 participants",
)
summary_api = replace_once(
    summary_api,
    '          measurementParticipants: displayTarget\n            ? measurementRoles.measurementParticipants\n            : legacySurvey.actual_measurer,',
    '          measurementParticipants: displayTarget\n            ? currentMeasurementParticipants\n            : legacySurvey.actual_measurer,',
    "summary API legacy participants",
)
# Compatibility fields consumed by table filters/edit state must mirror the same current display model.
summary_api = replace_once(
    summary_api,
    '        measurer: journal.measurer,\n        preliminary_display: preliminaryDisplay,',
    '        measurer: preliminaryDisplay.measurementParticipants === "-" ? null : preliminaryDisplay.measurementParticipants,\n        preliminary_display: preliminaryDisplay,',
    "summary API compatibility measurer",
)
summary_api = replace_once(
    summary_api,
    '        preliminary_surveyor: survey?.preliminary_surveyor || null,\n        actual_measurer: survey?.actual_measurer || null,\n        report_writer: survey?.report_writer || null,\n        survey_code: survey?.survey_code || null,',
    '        preliminary_surveyor: preliminaryDisplay.preliminarySurveyors === "-" ? null : preliminaryDisplay.preliminarySurveyors,\n        actual_measurer: preliminaryDisplay.measurementParticipants === "-" ? null : preliminaryDisplay.measurementParticipants,\n        report_writer: preliminaryDisplay.reportWriter === "-" ? null : preliminaryDisplay.reportWriter,\n        survey_code: preliminaryDisplay.publicSampleCode === "-" ? null : preliminaryDisplay.publicSampleCode,',
    "summary API compatibility role fields",
)
summary_api_path.write_text(summary_api, encoding="utf-8")

# Journal edit modal: current field is read-only exact-period data; historical comparison/reference values stay intact.
journal_path = Path("components/features/JournalEditForm.tsx")
journal = journal_path.read_text(encoding="utf-8")
journal = replace_once(
    journal,
    '  const addressAutoFillSequence = useRef(0);',
    '  const addressAutoFillSequence = useRef(0);\n  const currentRoleLoadSequence = useRef(0);',
    "JournalEditForm request sequence",
)
canonical_block = '''              // 측정 참여자는 현재 code/year/period의 target 원천만 사용한다.
              // previous journal 또는 legacy survey의 measurer를 fallback하지 않는다.
              if (data.preliminaryDisplay) {
                setPreliminaryDisplay(data.preliminaryDisplay);
                const canonicalMeasurementParticipants =
                  data.preliminaryDisplay.measurementParticipants &&
                  data.preliminaryDisplay.measurementParticipants !== "-"
                    ? data.preliminaryDisplay.measurementParticipants
                    : "";
                updated.measurer = canonicalMeasurementParticipants;
              } else {
                setPreliminaryDisplay(null);
                updated.measurer = "";
              }

'''
journal = replace_once(journal, canonical_block, "", "JournalEditForm entry-keyed current role block")
journal = replace_once(
    journal,
    '      measurer: entry.measurer || "",',
    '      measurer: "",',
    "JournalEditForm reinitialization",
)
effect_marker = '''  // 대기 중인 번호 변경 요청 조회 (수정 모드에서만, 일반 사용자만)
'''
role_effect = '''  // 현재 역할값은 폼에서 선택된 code/year/period의 exact target만 사용한다.
  // 전회 담당자/측정비 등 비교용 previousData는 이 effect와 분리해 그대로 유지한다.
  useEffect(() => {
    const code = String(formData.code || "").trim();
    const year = Number(formData.measurement_year);
    const period = String(formData.measurement_period || "").trim();
    const requestSequence = ++currentRoleLoadSequence.current;

    setFormData((previous) => ({ ...previous, measurer: "" }));
    setPreliminaryDisplay(null);
    if (!code || !Number.isInteger(year) || !period) return;

    const fetchCurrentRoles = async () => {
      try {
        const response = await fetch(
          `/api/journal/previous-data?code=${encodeURIComponent(code)}&year=${year}&period=${encodeURIComponent(period)}`,
        );
        if (!response.ok) return;
        const data = await response.json();
        if (requestSequence !== currentRoleLoadSequence.current) return;

        setFormData((previous) => {
          if (
            String(previous.code || "").trim() !== code
            || Number(previous.measurement_year) !== year
            || String(previous.measurement_period || "").trim() !== period
          ) return previous;
          return { ...previous, measurer: data.currentMeasurementParticipants || "" };
        });
        setPreliminaryDisplay(data.preliminaryDisplay || null);
      } catch (currentRoleError) {
        console.error("현재 측정 역할 조회 오류:", currentRoleError);
      }
    };

    fetchCurrentRoles();
  }, [formData.code, formData.measurement_year, formData.measurement_period]);

'''
journal = replace_once(journal, effect_marker, role_effect + effect_marker, "JournalEditForm current role effect")
journal = replace_once(
    journal,
    '      delete submitData.office_jurisdiction_raw;\n\n      const url = entry.id ? `/api/journal/${entry.id}` : "/api/journal";',
    '      delete submitData.office_jurisdiction_raw;\n      // 수정 모달의 측정 참여자는 current target에서 읽는 표시값이다. 과거 journal.measurer를 자동 덮어쓰지 않는다.\n      if (entry.id) delete submitData.measurer;\n\n      const url = entry.id ? `/api/journal/${entry.id}` : "/api/journal";',
    "JournalEditForm derived role save guard",
)
# Historical comparison/reference paths are explicitly preserved.
if "setPreviousContactInfo" not in journal or "setPreviousMeasurementFee" not in journal:
    raise SystemExit("JournalEditForm: historical comparison/reference paths were lost")
if "updated.measurer = updated.measurer || data.previousData.measurer" in journal:
    raise SystemExit("JournalEditForm: previous measurer fallback remains")
journal_path.write_text(journal, encoding="utf-8")

# Summary edit modal: do not re-save hidden historical journal.measurer.
summary_path = Path("components/features/SummaryTable.tsx")
summary = summary_path.read_text(encoding="utf-8")
summary = replace_once(
    summary,
    '      measurer: entry.measurer || "",',
    '      measurer: preliminaryDisplayOf(entry).measurementParticipants === "-"\n        ? ""\n        : preliminaryDisplayOf(entry).measurementParticipants,',
    "SummaryTable edit role source",
)
summary = replace_once(
    summary,
    '      const saveData = { ...editFormData } as any;\n      saveData.manager_mobile = normalizeManagerMobile(saveData.manager_mobile, saveData.manager_name);',
    '      const saveData = { ...editFormData } as any;\n      // 측정 참여자는 current Canonical 표시값이며 이 요약 수정 모달의 편집 대상이 아니다.\n      delete saveData.measurer;\n      saveData.manager_mobile = normalizeManagerMobile(saveData.manager_mobile, saveData.manager_name);',
    "SummaryTable hidden measurer save guard",
)
summary_path.write_text(summary, encoding="utf-8")

# Focused regression guards.
test_path = Path("tests/summary-journal-current-role-source.test.ts")
test = test_path.read_text(encoding="utf-8")
extra = r'''

test("multi-day current measurement participants are collected from the exact target only", () => {
  const dayForm = fs.readFileSync("lib/business/measurement-day-form.ts", "utf8");
  assert.match(dayForm, /export function collectMeasurementParticipantNames/);
  assert.match(dayForm, /measurementDayFormsFrom\(source\)\.flatMap/);
  assert.match(summaryApi, /const displayTarget = exactTarget;/);
  assert.match(summaryApi, /currentMeasurementParticipants/);
});

test("journal keeps previous comparison values but never injects previous measurer into the current role", () => {
  assert.match(journalForm, /setPreviousContactInfo/);
  assert.match(journalForm, /setPreviousMeasurementFee/);
  assert.match(journalForm, /currentMeasurementParticipants/);
  assert.match(journalForm, /currentRoleLoadSequence/);
  assert.doesNotMatch(journalForm, /measurer: entry\.measurer \|\| ""/);
  assert.doesNotMatch(journalForm, /updated\.measurer = updated\.measurer \|\| data\.previousData\.measurer/);
});

test("read-only current participant values are not written back by edit modals", () => {
  assert.match(journalForm, /if \(entry\.id\) delete submitData\.measurer/);
  assert.match(summaryUi, /delete saveData\.measurer/);
});

test("previous-data exposes current exact-period participants separately from history", () => {
  assert.match(previousDataApi, /currentMeasurementParticipants/);
  assert.match(previousDataApi, /collectMeasurementParticipantNames/);
  assert.match(previousDataApi, /previousData/);
  assert.match(previousDataApi, /setPrevious/);
});
'''
# Last assertion references frontend-only text and must not be kept in previousDataApi source check.
extra = extra.replace('  assert.match(previousDataApi, /setPrevious/);\n', '')
if "multi-day current measurement participants are collected" not in test:
    test += extra
test_path.write_text(test, encoding="utf-8")
