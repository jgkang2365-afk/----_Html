# Vercel 로그 확인 가이드

## 방법 1: Vercel 대시보드에서 로그 확인

1. **Vercel 대시보드 접속**
   - https://vercel.com/dashboard
   - 로그인 후 프로젝트 선택

2. **프로젝트 페이지에서 Logs 탭 찾기**
   - 프로젝트 이름 클릭 (예: "HTML")
   - 상단 메뉴에서 **"Logs"** 또는 **"Functions"** 탭 클릭
   - 또는 좌측 사이드바에서 **"Logs"** 메뉴 클릭

3. **로그 확인**
   - 실시간 로그 확인 가능
   - `[검색 API]`로 시작하는 로그 검색
   - 필터 기능으로 특정 키워드 검색 가능

## 방법 2: 브라우저 개발자 도구에서 확인 (더 쉬움)

**가장 쉬운 방법: 브라우저 개발자 도구 사용**

1. **브라우저 개발자 도구 열기**
   - `F12` 키 누르기
   - 또는 우클릭 → "검사" 선택

2. **Network 탭 열기**
   - 개발자 도구 상단 탭에서 "Network" 선택

3. **검색 실행**
   - 측정일지 검색 페이지에서 H0432 검색

4. **API 요청 확인**
   - Network 탭에서 `/api/journal/search` 요청 찾기
   - 클릭하여 상세 정보 확인
   - "Response" 또는 "Preview" 탭에서 응답 데이터 확인

5. **디버깅 정보 확인**
   - API 응답에 `debug` 객체가 포함되어 있음
   - 다음 정보 확인:
     - `h0432_in_business`: measurement_business에 H0432가 몇 건 있는지
     - `h0432_in_results`: 최종 결과에 H0432가 몇 건 있는지
     - `results_before_filter`: 필터링 전 결과 수
     - `results_after_filter`: 필터링 후 결과 수

## 방법 3: API 직접 호출

브라우저 주소창에 직접 입력:

```
https://html-tan-six.vercel.app/api/journal/search?code=H0432
```

또는 더 자세한 정보:

```
https://html-tan-six.vercel.app/api/sync/debug-columns
```

응답에서 JSON 데이터 확인 (브라우저 확장 프로그램 사용 시 가독성 향상)

## 참고사항

- 로그는 실시간으로 생성되므로, 검색 직후 확인해야 합니다
- Vercel 무료 플랜에서는 로그가 일정 시간 후 삭제될 수 있습니다
- 브라우저 개발자 도구가 가장 쉽고 즉시 확인 가능한 방법입니다
