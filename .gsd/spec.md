# 측정일지 입금일자 저장 보류 및 런타임 오류 해결 스펙

## 1. 개요
- 측정일지 수정 시 '입금일자' 관련 필드를 포함한 데이터 저장 과정에서 발생하는 런타임 오류를 해결한다.
- 원인 분석 결과, `PUT` API에서 클라이언트로부터 전달받은 불필요한 필드(DB 컬럼이 아닌 필드)가 포함된 채로 `update` 쿼리를 실행하여 발생하는 문제로 확인됨.

## 2. 주요 문제 분석
1. **API 데이터 위변조 및 스키마 불일치**:
   - `PUT /api/journal/[id]` API가 `...bodyWithoutNumbers`를 사용하여 클라이언트가 보낸 모든 데이터를 DB로 전달함.
   - `_isFromBusiness`, `_isFromSurvey`, `isSkipNumbering`, `office_jurisdiction_raw` 등 DB 컬럼이 아닌 필드가 포함되어 에러 발생.
2. **필드 누락**:
   - `is_skip_numbering` 변경 시 `revenue_type`('측정매출' vs '기타매출')이 함께 업데이트되지 않을 가능성.
3. **프론트엔드 중복 필드 전송**:
   - `JournalEditForm`에서 `isSkipNumbering`(카멜케이스)과 `is_skip_numbering`(스네이크케이스)을 동시에 전송하여 혼선 초래.

## 3. 해결 방안 (Proposed Changes)

### 3.1 Backend: `app/api/journal/[id]/route.ts`
- `updateData`를 생성할 때 spread 연산자(`...body`) 사용을 지양하고, **명시적으로 허용된 컬럼만 포함**하도록 수정.
- `revenue_type` 필드를 `is_skip_numbering` 상태에 맞춰 자동 갱신하도록 로직 추가.
- `_isFromBusiness`, `_isFromSurvey`, `isSkipNumbering` 등 불필요한 필드 필터링.

### 3.2 Frontend: `components/features/JournalEditForm.tsx`
- API 호출 시 `isSkipNumbering` 중복 전송 제거 (데이터베이스 표준인 `is_skip_numbering`만 사용).
- `formData` 정제 로직 강화.

## 4. 품질 보증 요건 (Verification Plan)
- [ ] 브라우저에서 측정일지 수정 폼 열기.
- [ ] 입금일자 및 입금액 입력 후 저장 시도.
- [ ] 네트워크 요청 본문에 불필요한 필드가 포함되지 않는지 확인.
- [ ] Supabase에서 데이터가 정상적으로 업데이트되는지 확인.
- [ ] `is_skip_numbering` 옵션 토글 시 `revenue_type`이 정상적으로 변경되는지 확인.

---
**주(Joo) 님, 위 설계 내용에 대해 승인해 주시면 실행 단계로 진입하겠습니다.**
