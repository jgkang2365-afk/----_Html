# Excel 파일 컬럼명 확인 가이드

## 문제 상황

현재 Excel 파일이 오래된 형식(.xls, Excel 97-2003)이어서 Node.js의 xlsx 라이브러리가 직접 읽지 못할 수 있습니다.

## 해결 방법

### 방법 1: Excel 파일을 .xlsx로 변환 (권장)

1. Excel에서 파일 열기
2. "다른 이름으로 저장" → "Excel 통합 문서 (*.xlsx)" 선택
3. 변환된 파일을 프로젝트 루트에 배치

### 방법 2: Excel에서 컬럼명 직접 확인

1. Excel에서 파일 열기
2. 첫 번째 행(헤더)의 컬럼명을 확인
3. 아래 표에 실제 컬럼명을 기재

## 사업장정보.xls 컬럼명 확인

Excel 파일에서 첫 번째 행의 컬럼명을 확인하고, 아래 항목과 매칭해주세요:

| 데이터베이스 필드 | 예상 컬럼명 | 실제 Excel 컬럼명 (확인 필요) |
|----------------|------------|---------------------------|
| code | 코드 | ? |
| business_name | 사업장명 | ? |
| business_number | 사업자번호 | ? |
| address1 | 주소1 | ? |
| address2 | 주소2 | ? |
| phone | 전화번호 | ? |
| fax | FAX | ? |
| representative_name | 대표자명 | ? |

## 측정사업장.xls 컬럼명 확인

Excel 파일에서 첫 번째 행의 컬럼명을 확인하고, 아래 항목과 매칭해주세요:

| 데이터베이스 필드 | 예상 컬럼명 | 실제 Excel 컬럼명 (확인 필요) |
|----------------|------------|---------------------------|
| code | 코드 | ? |
| year | 년도, 측정년도 | ? |
| period | 구분, 측정주기 | ? |
| business_name | 사업장명 | ? |
| business_number | 사업자번호 | ? |
| total_employees | 총인원 | ? |
| address | 주소 | ? |
| office_jurisdiction | 관할청명, 소재지 관할청 | ? |
| measurement_start_date | 측정시작일 | ? |
| measurement_end_date | 측정종료일 | ? |
| completion_status | 완료여부 | ? |
| measurer | 측정자, 담당 | ? |
| industrial_accident_number | 산재관리번호 | ? |
| representative_name | 대표자명 | ? |
| phone | 전화번호 | ? |
| fax | FAX | ? |
| manager_name | 담당자 | ? |
| manager_position | 직위 | ? |
| manager_mobile | BK열 (전화번호) | ? |
| manager_email | Email | ? |
| invoice_email | 세금 Email | ? |

## 확인 후 작업

실제 컬럼명을 확인한 후, `lib/sync/excel-sync.ts` 파일의 매핑 함수를 수정해주세요:

- `parseBusinessInfo()`: 사업장정보.xls 매핑
- `parseMeasurementBusiness()`: 측정사업장.xls 매핑

## 참고

- 컬럼명이 한글, 영문, 또는 다른 형식일 수 있습니다
- 일부 컬럼명에 공백이나 특수문자가 포함될 수 있습니다
- 대소문자를 구분하지 않고 매핑합니다

