# Supabase Storage 설정 가이드

## 1. Supabase Storage 버킷 생성

1. **Supabase 대시보드 접속**
   - https://supabase.com/dashboard
   - 프로젝트 선택

2. **Storage 메뉴 이동**
   - 왼쪽 사이드바에서 **Storage** 클릭

3. **새 버킷 생성**
   - **"New bucket"** 버튼 클릭
   - 버킷 정보 입력:
     - **Name**: `excel-files` (소문자, 하이픈만 사용)
     - **Public bucket**: ✅ 체크 (공개 버킷으로 설정)
     - **File size limit**: 50 MB (Excel 파일 크기 제한)
     - **Allowed MIME types**: 
       - `application/vnd.ms-excel` (.xls)
       - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx)

4. **버킷 생성 확인**
   - `excel-files` 버킷이 생성되었는지 확인

## 2. Storage 정책 설정 (RLS Policies)

Supabase Storage는 Row Level Security (RLS)를 사용합니다. 인증된 사용자만 파일을 업로드/다운로드할 수 있도록 설정합니다.

### 2.1 Storage Policies 설정

1. **Storage → Policies 메뉴 이동**
   - Storage 페이지에서 `excel-files` 버킷 클릭
   - **Policies** 탭 클릭
   - **"New Policy"** 버튼 클릭

**중요**: 정책 추가 화면에서 두 가지 옵션이 보입니다:
- **"Get started quickly"** - 템플릿 사용 (권장 ⭐ - SQL 입력 불필요)
- **"For full customization"** - SQL 직접 입력 (고급)

**"Get started quickly" 옵션을 선택하세요!** 템플릿을 사용하면 SQL을 직접 입력할 필요가 없습니다.

---

### 방법 A: 템플릿 사용 (권장 ⭐ - 가장 쉬움)

1. **"Get started quickly"** 카드 클릭
2. 각 정책을 하나씩 추가:

   **SELECT 정책 (파일 읽기):**
   - 템플릿: **"Allow authenticated users to read files"** 선택
   - 정책 이름: `Allow authenticated users to read files`
   - **"Review"** → **"Save policy"**

   **INSERT 정책 (파일 업로드):**
   - 템플릿: **"Allow authenticated users to upload files"** 선택
   - 정책 이름: `Allow authenticated users to upload files`
   - **"Review"** → **"Save policy"**

   **UPDATE 정책 (파일 업데이트 - 선택사항):**
   - 템플릿: **"Allow authenticated users to update files"** 선택
   - 정책 이름: `Allow authenticated users to update files`
   - **"Review"** → **"Save policy"**

   **DELETE 정책 (파일 삭제 - 선택사항):**
   - 템플릿: **"Allow authenticated users to delete files"** 선택
   - 정책 이름: `Allow authenticated users to delete files`
   - **"Review"** → **"Save policy"**

### 방법 B: SQL 직접 입력 (고급)

1. **"For full customization"** 카드 클릭
2. 각 정책을 하나씩 추가:

   **SELECT 정책 (파일 읽기):**
   - **Policy name**: `Allow authenticated users to read files`
   - **Allowed operation**: `SELECT`
   - **Policy definition**: 
     ```sql
     (bucket_id = 'excel-files'::text) AND (auth.role() = 'authenticated'::text)
     ```
   - **"Review"** → **"Save policy"**

   **INSERT 정책 (파일 업로드):**
   - **Policy name**: `Allow authenticated users to upload files`
   - **Allowed operation**: `INSERT`
   - **Policy definition**: 
     ```sql
     (bucket_id = 'excel-files'::text) AND (auth.role() = 'authenticated'::text)
     ```
   - **"Review"** → **"Save policy"**

   **UPDATE 정책 (파일 업데이트 - 선택사항):**
   - **Policy name**: `Allow authenticated users to update files`
   - **Allowed operation**: `UPDATE`
   - **Policy definition**: 
     ```sql
     (bucket_id = 'excel-files'::text) AND (auth.role() = 'authenticated'::text)
     ```
   - **"Review"** → **"Save policy"**

   **DELETE 정책 (파일 삭제 - 선택사항):**
   - **Policy name**: `Allow authenticated users to delete files`
   - **Allowed operation**: `DELETE`
   - **Policy definition**: 
     ```sql
     (bucket_id = 'excel-files'::text) AND (auth.role() = 'authenticated'::text)
     ```
   - **"Review"** → **"Save policy"**

## 3. 서버 사이드 권한 설정 (Service Role)

서버 사이드에서 파일을 읽기 위해 Service Role Key를 사용합니다.

**참고**: Service Role Key는 서버 사이드에서만 사용해야 하며, 클라이언트에 노출되면 안 됩니다.

## 4. 테스트

Storage 설정이 완료되면 다음을 테스트할 수 있습니다:

1. **파일 업로드 테스트**
   - 웹 UI에서 Excel 파일 업로드
   - Storage 버킷에서 파일 확인

2. **파일 읽기 테스트**
   - 동기화 API에서 파일 다운로드 확인
   - 로그에서 오류 확인

## 5. 파일 구조

업로드된 파일은 다음과 같은 경로에 저장됩니다:

```
excel-files/
  ├── business-info/
  │   ├── 사업장정보.xlsx
  │   └── 사업장정보.xls
  └── measurement-business/
      ├── 측정사업장.xlsx
      └── 측정사업장.xls
```

또는 타임스탬프를 포함한 파일명:

```
excel-files/
  ├── business-info-20250127-143022.xlsx
  └── measurement-business-20250127-143022.xlsx
```

## 6. 주의사항

- **파일 크기 제한**: 기본 50MB (필요 시 증가)
- **MIME 타입**: Excel 파일만 허용
- **공개 버킷**: 공개 버킷으로 설정하면 URL로 직접 접근 가능 (보안 고려 필요)
- **비용**: Supabase Storage 무료 플랜 1GB (충분)

## 7. 문제 해결

### 파일 업로드 실패
- Storage 정책 확인
- 파일 크기 제한 확인
- MIME 타입 확인

### 파일 읽기 실패
- Service Role Key 확인
- Storage 정책 확인
- 파일 경로 확인
