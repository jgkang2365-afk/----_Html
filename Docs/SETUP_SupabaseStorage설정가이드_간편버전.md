# Supabase Storage 설정 가이드 (간편 버전)

## 1. Supabase Storage 버킷 생성

1. **Supabase 대시보드 접속**
   - https://supabase.com/dashboard
   - 프로젝트 선택

2. **Storage 메뉴 이동**
   - 왼쪽 사이드바에서 **Storage** 클릭

3. **새 버킷 생성**
   - **"New bucket"** 버튼 클릭
   - 버킷 정보 입력:
     - **Name**: `excel-files`
     - **Public bucket**: ✅ 체크 (공개 버킷으로 설정)
   - **"Create bucket"** 클릭

## 2. Storage 정책 설정 (템플릿 사용 - 권장)

Supabase Storage 정책 설정 화면에서 **"Get started quickly" (템플릿 사용)** 옵션을 선택하세요.

### 옵션 1: 템플릿에서 정책 생성 (가장 쉬움)

1. **"Get started quickly"** 카드 클릭
2. 템플릿 선택 화면에서:
   - **"Allow authenticated users to upload files"** 템플릿 선택 (INSERT 정책)
   - 또는 **"Public access"** 템플릿 선택 (모든 정책 포함)
3. 정책 이름 입력 (예: `Allow authenticated upload`)
4. **"Review"** → **"Save policy"**

### 각 정책별 템플릿 선택

다음 정책들을 하나씩 추가하세요:

#### 1. SELECT 정책 (파일 읽기)
- 템플릿: **"Allow authenticated users to read files"** 또는 **"Public access"**
- 정책 이름: `Allow authenticated users to read files`

#### 2. INSERT 정책 (파일 업로드)
- 템플릿: **"Allow authenticated users to upload files"**
- 정책 이름: `Allow authenticated users to upload files`

#### 3. UPDATE 정책 (파일 업데이트 - 선택사항)
- 템플릿: **"Allow authenticated users to update files"**
- 정책 이름: `Allow authenticated users to update files`

#### 4. DELETE 정책 (파일 삭제 - 선택사항)
- 템플릿: **"Allow authenticated users to delete files"**
- 정책 이름: `Allow authenticated users to delete files`

## 3. 옵션 2: 공개 버킷으로 설정 (가장 간단)

만약 버킷을 **공개 버킷(Public bucket)**으로 생성했다면, 별도의 정책 설정 없이도 작동할 수 있습니다.

**주의**: 공개 버킷은 모든 사용자가 파일에 접근할 수 있으므로 보안을 고려해야 합니다.

## 4. 빠른 확인 방법

### 정책이 제대로 설정되었는지 확인:

1. **Storage → Policies** 메뉴에서
2. `excel-files` 버킷의 정책 목록 확인
3. 다음 정책들이 있는지 확인:
   - ✅ SELECT (읽기)
   - ✅ INSERT (업로드)
   - ✅ UPDATE (선택사항)
   - ✅ DELETE (선택사항)

## 5. 테스트 방법

정책 설정 후 파일 업로드 API를 테스트하여 확인할 수 있습니다.

## 문제 해결

### 정책 추가가 안 되는 경우
- 버킷이 생성되었는지 확인
- Storage → Policies 메뉴에서 `excel-files` 버킷 선택
- "New policy" 버튼 클릭

### SQL 입력이 어려운 경우
- **"Get started quickly" (템플릿 사용)** 옵션을 선택하세요
- 템플릿에서 자동으로 SQL이 생성됩니다

### 공개 버킷으로 설정하고 싶은 경우
- 버킷 생성 시 **"Public bucket"** 체크
- 또는 기존 버킷 → Settings → Public bucket 체크

## 참고

- 템플릿을 사용하면 SQL을 직접 입력할 필요가 없습니다
- 템플릿이 제공하는 기본 정책으로 대부분의 경우 충분합니다
- 필요에 따라 템플릿 기반 정책을 생성한 후 수정할 수 있습니다
