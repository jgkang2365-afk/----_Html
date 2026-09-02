from pathlib import Path
import re
import textwrap

# Summary UI: PR75 transplant is applied by the workflow before this script runs.
summary_path = Path("components/features/SummaryTable.tsx")
summary = summary_path.read_text(encoding="utf-8")
summary = summary.replace(
    'import { formatMeasurementPublicSampleAssignee, formatPreliminarySurveyorWithPublicSampleCode, type PreliminarySurveyDisplayModel } from "@/lib/preliminary-survey-v2/display-model";',
    'import { formatMeasurementPublicSampleAssignee, type PreliminarySurveyDisplayModel } from "@/lib/preliminary-survey-v2/display-model";',
)
old_second_row = '''    <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 md:gap-4">
      {cell("예비조사일", display.preliminarySurveyDate)}
      {cell("예비조사자명(공시료 코드)", formatPreliminarySurveyorWithPublicSampleCode(display))}
      {cell("측정 참여자", display.measurementParticipants)}
    </div>'''
new_second_row = '''    <div className="grid grid-cols-1 md:grid-cols-4 print:grid-cols-4 gap-3 md:gap-4">
      {cell("예비조사일", display.preliminarySurveyDate)}
      {cell("예비조사자", display.preliminarySurveyors)}
      {cell("측정자(공시료)", formatMeasurementPublicSampleAssignee(display))}
      {cell("측정 참여자", display.measurementParticipants)}
    </div>'''
if old_second_row not in summary:
    raise SystemExit("SummaryTable: PR75 second-row block not found")
summary = summary.replace(old_second_row, new_second_row, 1)
if "formatPreliminarySurveyorWithPublicSampleCode" in summary:
    raise SystemExit("SummaryTable: obsolete combined surveyor/code helper remains")
summary_path.write_text(summary, encoding="utf-8")

# Summary API: use current V2 Canonical sources and exact year/period target for role projection.
api_path = Path("app/api/summary/route.ts")
api = api_path.read_text(encoding="utf-8")
api = api.replace(
    'import { buildPreliminarySurveyDisplayModel } from "@/lib/preliminary-survey-v2/display-model";\nimport { measurementDayFormsFrom } from "@/lib/business/measurement-day-form";',
    'import { buildPreliminarySurveyDisplayModel, measurementRolesForDisplay } from "@/lib/preliminary-survey-v2/display-model";',
)
api = api.replace(
    '"id, measurement_target_business_id, recommended_date, participant_names",',
    '"id, measurement_target_business_id, recommended_date, participant_user_ids, participant_names",',
)
api = api.replace(
    '"plan_id, measurement_date, assignee_user_id, survey_code",',
    '"plan_id, measurement_date, assignee_user_id, survey_code, public_sample_code",',
)
api = api.replace(
    '''targets.forEach((target) => {
      measurementDayFormsFrom({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        measurerId: target.measurer_id,
        collaborators: target.collaborators,
      }).forEach((day) => {
        if (day.measurerId != null) displayUserIds.add(day.measurerId);
      });
    });''',
    '''targets.forEach((target) => {
      const roles = measurementRolesForDisplay({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        measurerId: target.measurer_id,
        collaborators: target.collaborators,
      });
      if (roles.reportWriterUserId != null) displayUserIds.add(roles.reportWriterUserId);
    });''',
)
marker = '''    (v2Assignments ?? []).forEach((assignment: any) => {
      const assigneeId = Number(assignment.assignee_user_id);
      if (Number.isInteger(assigneeId)) displayUserIds.add(assigneeId);
    });'''
if marker not in api:
    raise SystemExit("summary API: assignment user collection marker not found")
api = api.replace(
    marker,
    marker
    + '''
    (v2Plans ?? []).forEach((plan: any) => {
      const participantIds = Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids : [];
      participantIds.forEach((id: unknown) => {
        const participantId = Number(id);
        if (Number.isInteger(participantId)) displayUserIds.add(participantId);
      });
    });''',
    1,
)
api = api.replace(
    'supabase.from("users").select("id, name").in("id", [...displayUserIds])',
    'supabase.from("users").select("id, name, is_preliminary_survey_experienced").in("id", [...displayUserIds])',
)
api = api.replace(
    'const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), String(user.name ?? "")]));',
    'const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), String(user.name ?? "")]));\n    const userById = new Map((users ?? []).map((user: any) => [Number(user.id), user]));',
)
start = api.find(
    "      const nationalSupportStatus = journal.national_support_status || target?.national_support_status || null;"
)
end_marker = "      // 요약 수정 API가 measurement_business에도 저장하는 필드만 최신 동기화 원본을 우선한다."
end = api.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("summary API: display projection block boundaries not found")
replacement = '''      const nationalSupportStatus = journal.national_support_status || target?.national_support_status || null;
      // 역할 표시 원천은 반드시 해당 년도·주기의 exact target만 사용한다.
      // code-only/다른 주기 target fallback은 국고지원 보완에만 허용하고 역할 값에는 사용하지 않는다.
      const displayTarget = exactTarget;
      const v2Plan: any = displayTarget ? v2PlanByTarget.get(Number(displayTarget.id)) : null;
      const displayMeasurementDate = displayTarget?.measurement_date || journal.measurement_start_date || null;
      const measurementRoles = displayTarget ? measurementRolesForDisplay({
        dailyStaff: displayTarget.daily_staff,
        measurementDate: displayTarget.measurement_date,
        measurerId: displayTarget.measurer_id,
        collaborators: displayTarget.collaborators,
      }) : { measurementParticipants: [], reportWriterUserId: null };
      const v2PlanAssignments = v2Plan
        ? (v2Assignments ?? [])
          .filter((assignment: any) => String(assignment.plan_id) === String(v2Plan.id))
          .sort((left: any, right: any) => String(left.measurement_date).localeCompare(String(right.measurement_date)))
        : [];
      const v2Assignment: any = v2PlanAssignments.find(
        (assignment: any) => assignment.measurement_date === displayMeasurementDate,
      ) ?? v2PlanAssignments[0] ?? null;
      const participantIds = Array.isArray(v2Plan?.participant_user_ids)
        ? v2Plan.participant_user_ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
        : [];
      const v2SurveyorUsers = participantIds
        .map((id: number) => userById.get(id))
        .filter(Boolean)
        .map((user: any) => ({
          name: user.name,
          isExperienced: user.is_preliminary_survey_experienced,
        }));
      const reportWriter = measurementRoles.reportWriterUserId == null
        ? null
        : userNameById.get(Number(measurementRoles.reportWriterUserId));
      const legacySurvey = relatedSurveys.find((item: any) => item.measurement_date === displayMeasurementDate)
        ?? relatedSurveys.at(-1)
        ?? null;
      const preliminaryDisplay = buildPreliminarySurveyDisplayModel({
        v2: v2Plan ? {
          preliminarySurveyDate: v2Plan.recommended_date,
          preliminarySurveyors: v2Plan.participant_names,
          preliminarySurveyorUsers: v2SurveyorUsers,
          measurementPublicSampleAssignee: v2Assignment
            ? userNameById.get(Number(v2Assignment.assignee_user_id))
            : null,
          publicSampleCode: v2Assignment?.public_sample_code ?? v2Assignment?.survey_code,
          measurementPublicSampleAssignments: v2PlanAssignments.map((assignment: any) => ({
            measurementDate: assignment.measurement_date,
            assignee: userNameById.get(Number(assignment.assignee_user_id)),
            publicSampleCode: assignment.public_sample_code ?? assignment.survey_code,
          })),
          measurementParticipants: measurementRoles.measurementParticipants,
          reportWriter,
        } : null,
        legacy: !v2Plan && legacySurvey ? {
          preliminarySurveyDate: null,
          preliminarySurveyors: legacySurvey.preliminary_surveyor,
          measurementPublicSampleAssignee: legacySurvey.measurer,
          publicSampleCode: legacySurvey.survey_code,
          measurementParticipants: displayTarget
            ? measurementRoles.measurementParticipants
            : legacySurvey.actual_measurer,
          reportWriter: displayTarget ? reportWriter : legacySurvey.report_writer,
        } : null,
      });
'''
api = api[:start] + replacement + api[end:]
api = api.replace(
    "public_sample_measurer: survey?.measurer || null,",
    'public_sample_measurer: preliminaryDisplay.measurementPublicSampleAssignee === "-" ? null : preliminaryDisplay.measurementPublicSampleAssignee,',
)
if "measurementDayFormsFrom" in api:
    raise SystemExit("summary API: stale measurementDayFormsFrom usage remains")
api_path.write_text(api, encoding="utf-8")

# Journal edit: current code/year/period target participants only.
journal_path = Path("components/features/JournalEditForm.tsx")
journal = journal_path.read_text(encoding="utf-8")
if '    measurer: entry.measurer || "",' not in journal:
    raise SystemExit("JournalEditForm: initial measurer source not found")
journal = journal.replace('    measurer: entry.measurer || "",', '    measurer: "",', 1)
journal = journal.replace(
    '                updated.measurer = updated.measurer || data.previousData.measurer || "";\n',
    "",
)
survey_marker = "              // 예비조사 정보 (우선순위: 예비조사 정보가 최우선)\n"
if survey_marker not in journal:
    raise SystemExit("JournalEditForm: survey marker not found")
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
journal = journal.replace(survey_marker, canonical_block + survey_marker, 1)
measurer_block = re.compile(
    r'''
\s*// 3\. 측정자 통합 \(모든 일자의 측정자 합집합\)
\s*const allMeasurers = new Set<string>\(\);
\s*surveys\.forEach\(\(s: any\) => \{
\s*if \(s\.measurer\) \{
\s*s\.measurer\.split\(','\)\.forEach\(\(m: string\) => \{
\s*const trimmed = m\.trim\(\);
\s*if \(trimmed\) allMeasurers\.add\(trimmed\);
\s*\}\);
\s*\}
\s*\}\);

\s*if \(allMeasurers\.size > 0 && !prev\.measurer\) \{
\s*updated\.measurer = Array\.from\(allMeasurers\)\.join\(', '\);
\s*\}
''',
    re.MULTILINE,
)
journal, count = measurer_block.subn(
    "\n                // 3. 측정 참여자는 위 current-period Canonical projection을 유지한다.\n",
    journal,
    count=1,
)
if count != 1:
    raise SystemExit(f"JournalEditForm: legacy survey measurer block removal count={count}")
old_input = '''        <Input
          label="측정자"
          value={formData.measurer}
          onChange={(e) => setFormData({ ...formData, measurer: e.target.value })}
          placeholder="측정자 입력"
          disabled={isLockedByCompletion}
          className={isLockedByCompletion ? "bg-surface-50" : ""}
        />'''
new_input = '''        <Input
          label="측정 참여자"
          value={formData.measurer}
          placeholder="현재 측정대상사업장 참여자"
          disabled
          className="bg-surface-50"
        />'''
if old_input not in journal:
    raise SystemExit("JournalEditForm: measurement input block not found")
journal = journal.replace(old_input, new_input, 1)
if "updated.measurer = updated.measurer || data.previousData.measurer" in journal:
    raise SystemExit("JournalEditForm: previousData measurer fallback remains")
if "const allMeasurers = new Set<string>();" in journal:
    raise SystemExit("JournalEditForm: legacy survey measurer aggregation remains")
journal_path.write_text(journal, encoding="utf-8")

# Focused source guards.
test_path = Path("tests/summary-journal-current-role-source.test.ts")
test_path.write_text(
    textwrap.dedent(
        r'''\
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import test from "node:test";

        const summaryUi = fs.readFileSync("components/features/SummaryTable.tsx", "utf8");
        const summaryApi = fs.readFileSync("app/api/summary/route.ts", "utf8");
        const journalForm = fs.readFileSync("components/features/JournalEditForm.tsx", "utf8");
        const previousDataApi = fs.readFileSync("app/api/journal/previous-data/route.ts", "utf8");

        test("summary uses separate current Canonical role cells", () => {
          assert.match(summaryUi, /cell\("예비조사일"/);
          assert.match(summaryUi, /cell\("예비조사자", display\.preliminarySurveyors\)/);
          assert.match(summaryUi, /cell\("측정자\(공시료\)", formatMeasurementPublicSampleAssignee\(display\)\)/);
          assert.match(summaryUi, /cell\("측정 참여자", display\.measurementParticipants\)/);
          assert.doesNotMatch(summaryUi, /예비조사자명\(공시료 코드\)/);
        });

        test("summary role projection never uses a loose cross-period target", () => {
          assert.match(summaryApi, /const displayTarget = exactTarget;/);
          assert.match(summaryApi, /public_sample_code/);
          assert.match(summaryApi, /measurementPublicSampleAssignments/);
          assert.match(summaryApi, /measurementRolesForDisplay/);
        });

        test("journal measurement participant is read-only current-period Canonical data", () => {
          assert.match(journalForm, /label="측정 참여자"/);
          assert.match(journalForm, /measurer: ""/);
          assert.match(journalForm, /data\.preliminaryDisplay\.measurementParticipants/);
          assert.doesNotMatch(journalForm, /updated\.measurer = updated\.measurer \|\| data\.previousData\.measurer/);
          assert.doesNotMatch(journalForm, /const allMeasurers = new Set<string>/);
        });

        test("previous-data Canonical projection is exact code year period", () => {
          assert.match(previousDataApi, /\.eq\("code", trimmedCode\)/);
          assert.match(previousDataApi, /\.eq\("year", measurementYear\)/);
          assert.match(previousDataApi, /\.eq\("period", period\)/);
          assert.match(previousDataApi, /preliminaryDisplay/);
        });
        '''
    ),
    encoding="utf-8",
)
