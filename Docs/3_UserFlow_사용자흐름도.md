# User Flow (사용자 흐름도)

**프로젝트명**: 측정일지 관리 시스템  
**버전**: v1.0  
**작성일**: 2025-01-27

---

## 1. 전체 사용자 여정 개요

```mermaid
graph TD
    Start([시작: 시스템 접속]) --> Login{로그인}
    Login -->|성공| MainMenu[메인 메뉴]
    Login -->|실패| LoginError[로그인 오류<br/>재시도]
    LoginError --> Login
    
    MainMenu --> Dashboard[대시보드]
    MainMenu --> Survey[예비조사 탭]
    MainMenu --> Journal[측정일지 탭]
    MainMenu --> Summary[측정정보 요약]
    MainMenu --> Sales[매출관리]
    
    Dashboard --> End1([작업 완료])
    Survey --> End2([작업 완료])
    Journal --> End3([작업 완료])
    Summary --> End4([작업 완료])
    Sales --> End5([작업 완료])
```

---

## 2. FEAT-1: Excel 자동 동기화 흐름

```mermaid
graph TD
    Start([Excel 파일 업데이트<br/>Z:\data\측정팀\...]) --> Monitor{파일 변경<br/>감지}
    Monitor -->|변경 감지| Read[Excel 파일 읽기]
    Monitor -->|변경 없음| Wait[대기]
    Wait --> Monitor
    
    Read --> Parse[데이터 파싱]
    Parse --> Validate{데이터<br/>검증}
    Validate -->|오류| LogError[오류 로그 기록]
    Validate -->|성공| Compare[기존 데이터와<br/>비교]
    
    Compare --> HasChange{변경사항<br/>있음?}
    HasChange -->|없음| Skip[동기화 건너뛰기]
    HasChange -->|있음| UpdateDB[(데이터베이스<br/>업데이트)]
    
    UpdateDB --> LogSync[동기화 로그<br/>기록]
    LogSync --> Notify{사용자에게<br/>알림?}
    Notify -->|예| ShowAlert[알림 표시]
    Notify -->|아니오| Complete([동기화 완료])
    ShowAlert --> Complete
    LogError --> Complete
    Skip --> Complete
```

---

## 3. FEAT-2: 측정일지 검색 및 수정 흐름

```mermaid
graph TD
    Start([측정일지 탭 접속]) --> SearchForm[검색 조건 입력<br/>- 측정년도<br/>- 측정주기<br/>- 사업장명<br/>- 지정한계_관할지청<br/>- 주소]
    
    SearchForm --> SearchBtn{검색 버튼<br/>클릭}
    SearchBtn --> QueryDB[(데이터베이스<br/>조회)]
    
    QueryDB --> FilterResult[*번외* 포함<br/>자료 제외]
    FilterResult --> ShowList[검색 결과<br/>목록 표시<br/>최신 자료 우선]
    
    ShowList --> SelectItem{측정일지<br/>선택}
    SelectItem --> LoadData[측정일지<br/>상세 데이터 로드]
    
    LoadData --> EditForm[수정 폼 표시<br/>자동 입력 필드:<br/>- 소재지 관할청<br/>- 지정한계_관할지청<br/>- 공문연번<br/>- 연번<br/>- 5인 이상 연번]
    
    EditForm --> UserEdit[사용자 수정]
    UserEdit --> SaveBtn{저장 버튼<br/>클릭}
    
    SaveBtn --> ValidateYear{측정년도/<br/>측정주기<br/>변경 확인}
    ValidateYear -->|변경 없음| Warning[경고창 표시<br/>'변경되지 않았습니다.<br/>계속하시겠습니까?']
    ValidateYear -->|변경됨| ValidateData[데이터 검증]
    
    Warning --> UserConfirm{사용자<br/>확인}
    UserConfirm -->|취소| EditForm
    UserConfirm -->|계속| ValidateData
    
    ValidateData --> CheckComplete{완료여부<br/>확인}
    CheckComplete -->|완료| BlockEdit[수정 차단<br/>'완료된 측정일지는<br/>수정할 수 없습니다.']
    CheckComplete -->|미완료| SaveDB[(데이터베이스<br/>저장)]
    
    SaveDB --> SuccessMsg[저장 성공<br/>메시지]
    SuccessMsg --> ShowList
    BlockEdit --> EditForm
```

---

## 4. FEAT-3: 공문연번/연번 자동 부여 흐름

```mermaid
graph TD
    Start([측정일지 저장<br/>또는 신규 생성]) --> GetOffice[지정한계_관할지청<br/>확인]
    
    GetOffice --> OfficeType{관할지청<br/>유형}
    OfficeType -->|대전지방고용노동청<br/>천안지청| Prefix1[접두사: '천-']
    OfficeType -->|대전지방고용노동청| Prefix2[접두사: '대-']
    OfficeType -->|중부지방고용노동청<br/>평택지청| Prefix3[접두사: '평-']
    OfficeType -->|중부지방고용노동청<br/>경기지청| Prefix4[접두사: '경-']
    
    Prefix1 --> GetLastNum1[마지막 공문연번<br/>조회<br/>천-XXX]
    Prefix2 --> GetLastNum2[마지막 공문연번<br/>조회<br/>대-XXX]
    Prefix3 --> GetLastNum3[마지막 공문연번<br/>조회<br/>평-XXX]
    Prefix4 --> GetLastNum4[마지막 공문연번<br/>조회<br/>경-XXX]
    
    GetLastNum1 --> Increment1[번호 증가<br/>001, 002, 003...]
    GetLastNum2 --> Increment2[번호 증가<br/>001, 002, 003...]
    GetLastNum3 --> Increment3[번호 증가<br/>001, 002, 003...]
    GetLastNum4 --> Increment4[번호 증가<br/>001, 002, 003...]
    
    Increment1 --> AssignDocNum[공문연번 부여]
    Increment2 --> AssignDocNum
    Increment3 --> AssignDocNum
    Increment4 --> AssignDocNum
    
    AssignDocNum --> GetPeriod[측정주기 확인<br/>상반기/하반기]
    GetPeriod --> GetOffice2[지정한계_관할지청<br/>+ 측정주기]
    
    GetOffice2 --> GetLastSeq[마지막 연번 조회<br/>관할지청별 + 주기별]
    GetLastSeq --> IncrementSeq[연번 증가<br/>001, 002, 003...]
    IncrementSeq --> AssignSeq[연번 부여]
    
    AssignSeq --> GetTotalEmp[총인원 확인<br/>측정사업장.xls]
    GetTotalEmp --> CheckEmp{총인원<br/>>= 5명?}
    
    CheckEmp -->|예| GetLast5Num[마지막 5인 이상<br/>연번 조회]
    CheckEmp -->|아니오| GetPrev5Num[직전 5인 이상<br/>연번 조회<br/>중복 허용]
    
    GetLast5Num --> Increment5Num[5인 이상 연번<br/>증가<br/>001, 002, 003...]
    GetPrev5Num --> Reuse5Num[직전 번호<br/>재사용]
    
    Increment5Num --> Assign5Num[5인 이상 연번 부여]
    Reuse5Num --> Assign5Num
    
    Assign5Num --> Complete([번호 부여 완료])
```

---

## 5. 예비조사 입력 흐름

```mermaid
graph TD
    Start([예비조사 탭 접속]) --> NewBtn{신규 등록<br/>버튼 클릭}
    NewBtn --> Form[예비조사 폼 표시]
    
    Form --> InputDate[측정일 입력<br/>20260101 또는 0101]
    InputDate --> FormatDate[날짜 형식 변환<br/>01/01]
    FormatDate --> AutoEndDate[종료일 자동 설정<br/>측정일과 동일]
    
    AutoEndDate --> CalcWeekday[측정요일 계산<br/>측정일 ~ 종료일<br/>공휴일 제외]
    
    CalcWeekday --> SelectBusiness[사업장명 선택<br/>드롭다운<br/>또는 신규 등록]
    SelectBusiness --> AutoAddress[주소 자동 입력<br/>사업장정보에서]
    
    AutoAddress --> SelectMeasurer[측정자 선택<br/>복수 선택 가능]
    SelectMeasurer --> AutoCode[공시료 코드<br/>자동 부여<br/>첫 번째 측정자 기준]
    
    AutoCode --> SelectSurvey[예비조사자 선택<br/>체크박스<br/>복수 선택]
    SelectSurvey --> SelectActual[실측정자 선택<br/>체크박스<br/>복수 선택]
    SelectActual --> SelectReport[보고서 담당 선택<br/>체크박스<br/>복수 선택]
    
    SelectReport --> SaveBtn{저장 버튼<br/>클릭}
    SaveBtn --> ValidateForm[폼 검증]
    ValidateForm -->|오류| ShowError[오류 메시지<br/>표시]
    ValidateForm -->|성공| SaveDB[(데이터베이스<br/>저장)]
    
    ShowError --> Form
    SaveDB --> SuccessMsg[저장 성공]
    SuccessMsg --> ListView[목록 화면으로<br/>이동]
```

---

## 6. 대시보드 조회 흐름

```mermaid
graph TD
    Start([대시보드 접속]) --> LoadData[데이터 로드]
    
    LoadData --> CalcTotal[측정건수 계산]
    CalcTotal --> CalcIncomplete[미완료 건수 계산]
    CalcIncomplete --> CalcOverdue[25일 경과<br/>사업장 계산]
    CalcOverdue --> CountByOffice[지정한계_관할지청별<br/>사업장 수 계산]
    CountByOffice --> CalcRevenue[매출현황 계산<br/>측정비/기타매출]
    CalcRevenue --> CalcTrend[년도별/월별<br/>매출 추이 계산]
    CalcTrend --> CalcUnpaid[미수관리 계산<br/>년도별/주기별]
    
    CalcUnpaid --> Display[대시보드 표시]
    Display --> FilterBtn{필터 버튼<br/>클릭?}
    FilterBtn -->|예| FilterForm[필터 조건 입력]
    FilterBtn -->|아니오| ExportBtn{엑셀 다운로드<br/>버튼 클릭?}
    
    FilterForm --> ApplyFilter[필터 적용]
    ApplyFilter --> Reload[데이터 재로드]
    Reload --> Display
    
    ExportBtn -->|예| GenerateExcel[엑셀 파일 생성]
    ExportBtn -->|아니오| End([대시보드 조회 완료])
    GenerateExcel --> Download[파일 다운로드]
    Download --> End
```

---

## 7. 측정정보 요약 조회 및 수정 흐름

```mermaid
graph TD
    Start([측정정보 요약 탭 접속]) --> SearchForm[검색 조건 입력<br/>- 측정년도<br/>- 측정주기<br/>- 사업장명]
    
    SearchForm --> SearchBtn{검색 버튼<br/>클릭}
    SearchBtn --> QueryDB[(데이터베이스<br/>조회)]
    
    QueryDB --> JoinData[측정일지 +<br/>예비조사 데이터<br/>조인]
    JoinData --> ShowSummary[요약 정보 표시<br/>수정 불가 필드:<br/>- 공문연번<br/>- 연번<br/>- 5인 이상 연번]
    
    ShowSummary --> EditBtn{수정 버튼<br/>클릭?}
    EditBtn -->|예| EditForm[수정 폼 표시<br/>수정 가능 필드만]
    EditBtn -->|아니오| ExportBtn{엑셀 다운로드<br/>버튼 클릭?}
    
    EditForm --> UserEdit[사용자 수정]
    UserEdit --> SaveBtn{저장 버튼<br/>클릭}
    SaveBtn --> ValidateData[데이터 검증]
    ValidateData --> UpdateJournal[(측정일지<br/>데이터 업데이트)]
    
    UpdateJournal --> SuccessMsg[저장 성공 메시지]
    SuccessMsg --> ShowSummary
    
    ExportBtn -->|예| GenerateExcel[엑셀 파일 생성]
    ExportBtn -->|아니오| End([작업 완료])
    GenerateExcel --> Download[파일 다운로드]
    Download --> End
```

---

## 8. 매출관리 조회 흐름

```mermaid
graph TD
    Start([매출관리 탭 접속]) --> FilterForm[필터 조건 선택<br/>- 년도별<br/>- 업체별<br/>- 측정 주기별<br/>- 지정한계_관할지청별]
    
    FilterForm --> ApplyFilter[필터 적용]
    ApplyFilter --> QueryDB[(데이터베이스<br/>조회)]
    
    QueryDB --> CalcDetails[상세 내역 계산<br/>- 계산서 발행 여부<br/>- 측정비 사업장/국고<br/>- 입출금 내역<br/>- 미수금액<br/>- 미수금]
    
    CalcDetails --> DisplayTable[상세 테이블 표시]
    DisplayTable --> ExportBtn{엑셀 다운로드<br/>버튼 클릭?}
    ExportBtn -->|예| GenerateExcel[엑셀 파일 생성]
    ExportBtn -->|아니오| End([조회 완료])
    GenerateExcel --> Download[파일 다운로드]
    Download --> End
```

---

## 9. 성공 및 실패 분기

### 9.1 성공 루프 (Sticky Loop)

사용자가 성공적으로 작업을 완료한 후 다시 시스템을 사용하게 만드는 요소:

1. **즉각적인 피드백**: 저장 성공 메시지, 데이터 업데이트 확인
2. **편리한 검색**: 빠른 검색으로 필요한 정보 즉시 확인
3. **자동화된 처리**: 번호 부여 등 복잡한 작업 자동 처리
4. **실시간 동기화**: 최신 데이터 항상 확인 가능

### 9.2 실패 분기 처리

- **검색 결과 없음**: "검색 결과가 없습니다. 다른 조건으로 검색해주세요."
- **저장 실패**: "저장에 실패했습니다. 다시 시도해주세요."
- **권한 없음**: "이 작업을 수행할 권한이 없습니다."
- **완료된 측정일지 수정 시도**: "완료된 측정일지는 수정할 수 없습니다."

---

## 10. 온보딩 흐름 (초기 사용자)

```mermaid
graph TD
    Start([첫 접속]) --> Welcome[환영 화면]
    Welcome --> Tutorial{튜토리얼<br/>보기?}
    Tutorial -->|예| ShowTutorial[간단한 사용 가이드<br/>- 각 탭 설명<br/>- 주요 기능 소개]
    Tutorial -->|아니오| MainMenu[메인 메뉴로 이동]
    ShowTutorial --> MainMenu
    MainMenu --> FirstTask[첫 작업 수행]
    FirstTask --> Success{성공?}
    Success -->|예| Encourage[긍정적 피드백<br/>'잘하셨습니다!']
    Success -->|아니오| Help[도움말 표시]
    Help --> FirstTask
    Encourage --> RegularUse([정기적 사용 시작])
```

