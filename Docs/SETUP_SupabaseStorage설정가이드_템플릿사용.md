# Supabase Storage 설정 가이드 - 템플릿 사용 방법

## 정책 설정 화면에서 막히셨나요?

정책 추가 화면에서 **"Get started quickly" (템플릿 사용)** 옵션을 선택하시면 SQL을 직접 입력할 필요가 없습니다!

## 단계별 가이드

### 1. 정책 추가 화면 열기

1. Supabase 대시보드 → Storage
2. `excel-files` 버킷 클릭
3. **Policies** 탭 클릭
4. **"New Policy"** 버튼 클릭

### 2. 템플릿 선택

정책 추가 화면에서 **"Get started quickly"** 카드를 클릭하세요.

### 3. 필요한 정책들 추가

각 정책을 하나씩 추가합니다:

#### 정책 1: SELECT (파일 읽기)

1. **"New Policy"** → **"Get started quickly"** 클릭
2. 템플릿 목록에서:
   - **"Allow authenticated users to read files"** 선택
   - 또는 **"Public access"** 템플릿 선택 (더 간단)
3. **"Review"** → **"Save policy"**

#### 정책 2: INSERT (파일 업로드)

1. **"New Policy"** → **"Get started quickly"** 클릭
2. 템플릿 목록에서:
   - **"Allow authenticated users to upload files"** 선택
3. **"Review"** → **"Save policy"**

#### 정책 3: UPDATE (선택사항)

1. **"New Policy"** → **"Get started quickly"** 클릭
2. 템플릿 목록에서:
   - **"Allow authenticated users to update files"** 선택
3. **"Review"** → **"Save policy"**

#### 정책 4: DELETE (선택사항)

1. **"New Policy"** → **"Get started quickly"** 클릭
2. 템플릿 목록에서:
   - **"Allow authenticated users to delete files"** 선택
3. **"Review"** → **"Save policy"**

## 가장 간단한 방법: 공개 버킷 사용

만약 보안이 크게 중요하지 않다면:

1. 버킷 생성 시 **"Public bucket"** 체크
2. 별도 정책 설정 불필요
3. 모든 인증된 사용자가 파일 업로드/다운로드 가능

**주의**: 공개 버킷은 모든 사용자가 파일에 접근할 수 있습니다.

## 최소한의 정책 (필수만)

파일 업로드 기능을 사용하려면 최소한 다음 정책만 필요합니다:

1. **SELECT 정책** - 파일 읽기 (필수)
2. **INSERT 정책** - 파일 업로드 (필수)

UPDATE와 DELETE는 선택사항입니다.

## 문제 해결

### 템플릿이 보이지 않는 경우
- Supabase 대시보드의 최신 버전을 사용하고 있는지 확인
- 브라우저 새로고침

### 정책을 여러 개 추가해야 하는 경우
- 각 정책마다 **"New Policy"** 버튼을 클릭하여 하나씩 추가
- 한 번에 여러 정책을 추가할 수 없습니다

### 템플릿 대신 SQL을 직접 입력하고 싶은 경우
- **"For full customization"** 옵션 선택
- SQL 코드 입력 (고급 사용자용)
