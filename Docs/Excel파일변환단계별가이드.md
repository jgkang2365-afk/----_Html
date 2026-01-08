# Excel 파일 변환 단계별 가이드

## 변환할 파일 위치

**경로**: `C:\Users\USER\Desktop\cursor\측정일지_Html\`

**변환할 파일**:
1. `사업장정보.xls` → `사업장정보.xlsx`
2. `측정사업장.xls` → `측정사업장.xlsx`

## 변환 방법

### 방법 1: Excel에서 직접 변환 (권장)

1. **사업장정보.xls 변환**
   - Excel에서 `사업장정보.xls` 파일 열기
   - 키보드: `F12` 또는 메뉴: `파일` → `다른 이름으로 저장`
   - 파일 형식 드롭다운: **"Excel 통합 문서 (*.xlsx)"** 선택
   - 파일명: `사업장정보.xlsx` (확장자만 변경)
   - 저장 위치: 같은 폴더 (`C:\Users\USER\Desktop\cursor\측정일지_Html\`)
   - `저장` 클릭

2. **측정사업장.xls 변환**
   - 동일한 방법으로 `측정사업장.xls`를 `측정사업장.xlsx`로 변환

### 방법 2: Excel에서 일괄 변환 (파일이 많은 경우)

1. Excel에서 `파일` → `열기`
2. 폴더 선택: `C:\Users\USER\Desktop\cursor\측정일지_Html\`
3. `.xls` 파일들을 선택
4. 각 파일을 열어서 `F12` → `Excel 통합 문서 (*.xlsx)` 형식으로 저장

## 변환 확인

변환 후 다음 파일들이 생성되었는지 확인:

```
C:\Users\USER\Desktop\cursor\측정일지_Html\
  ├── 사업장정보.xls (원본 - 삭제하지 않아도 됨)
  ├── 사업장정보.xlsx (변환된 파일) ✅
  ├── 측정사업장.xls (원본 - 삭제하지 않아도 됨)
  └── 측정사업장.xlsx (변환된 파일) ✅
```

## 참고사항

- 원본 `.xls` 파일은 삭제하지 않아도 됩니다 (백업용)
- 코드는 `.xlsx` 파일을 우선적으로 사용합니다
- `.xlsx` 파일이 없으면 `.xls` 파일을 시도합니다
- 변환 후 동기화 API를 테스트할 수 있습니다

## 변환 후 테스트

변환이 완료되면 다음 명령어로 테스트할 수 있습니다:

```bash
# 개발 서버가 실행 중인 경우
# 브라우저에서: http://localhost:3000/api/test-excel?file=business-info
# 또는
# http://localhost:3000/api/test-excel?file=measurement-business
```

