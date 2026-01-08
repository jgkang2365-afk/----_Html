# Excel 파일 형식 변환 안내

## 문제

현재 Excel 파일이 오래된 형식(.xls, Excel 97-2003)이어서 Node.js의 xlsx 라이브러리가 읽지 못할 수 있습니다.

## 해결 방법

### Excel에서 .xlsx로 변환

1. Excel에서 `사업장정보.xls` 파일 열기
2. "파일" → "다른 이름으로 저장"
3. 파일 형식: "Excel 통합 문서 (*.xlsx)" 선택
4. 파일명: `사업장정보.xlsx`로 저장
5. 프로젝트 루트에 `사업장정보.xlsx` 파일 배치

6. `측정사업장.xls` 파일도 동일하게 변환하여 `측정사업장.xlsx`로 저장

### 코드 수정

변환 후 `lib/sync/excel-sync.ts` 파일에서 파일명을 수정해야 합니다:

```typescript
// 기존
const fileName = "사업장정보.xls";
const fileName = "측정사업장.xls";

// 변경
const fileName = "사업장정보.xlsx";
const fileName = "측정사업장.xlsx";
```

또는 두 형식을 모두 지원하도록 코드를 수정할 수 있습니다.

## 대안: 파일 업로드 기능

프로덕션 환경(Vercel)에서는 파일 시스템 접근이 제한되므로, 파일 업로드 기능을 구현하는 것을 권장합니다:

1. 사용자가 웹 인터페이스에서 Excel 파일 업로드
2. 업로드된 파일을 Supabase Storage에 저장
3. API에서 Supabase Storage의 파일을 읽어서 동기화

이 방법은 향후 구현할 수 있습니다.

