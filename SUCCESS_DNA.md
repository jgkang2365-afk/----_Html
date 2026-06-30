# SUCCESS DNA

## MISTAKE LOG (실수 로그)

### 1. [2026-06-19] 입력 폼 그리드 및 캘린더 정렬 어긋남
* **원인:**
  1. 그리드 레이아웃 내에서 특정 열(예: 계산서 메일) 아래에만 "전회:" 헬퍼 텍스트가 표시되면서 래퍼 높이가 늘어남. 이로 인해 인접한 다른 열(예: 전자계산서 발행일, 계산서 메일2)의 입력창 라인이 아래로 처지고 가로선이 일치하지 않는 현상 발생.
  2. 캘린더 아이콘이 추가되는 입력 필드에서 `h-11 md:h-10`과 같은 높이 하드코딩이 개별적으로 적용되어 다른 일반 입력창(기본 padding인 `py-3`을 사용하여 높이가 자연스럽게 유동적인 형태)과 높이가 불일치함. 또한 `type="date"` 및 `type="text"` 브라우저 고유 기본값에 따른 편차가 발생함.
  3. `relative flex items-center` 래퍼 내부에 absolute 아이콘이 있을 때, 중앙 정렬(`top-1/2 -translate-y-1/2`)이 명시되지 않고 flex에만 의존하여 레이아웃이 미세하게 어긋남.
  4. 특정 폰트(예: `.email-mono-font`) 적용 시 baseline 정렬을 맞추기 위해 강제로 준 `padding-bottom: 2px !important` 스타일이 오히려 입력 텍스트를 심각하게 아래로 치우치게 만들고 인풋 자체의 높이도 얇게 찌그러뜨림.
* **해결법:**
  1. 가변 헬퍼 텍스트("전회:" 정보 등)가 있는 그리드 컬럼들은 모두 부모 래퍼에 `relative pb-5`를 적용하고, 헬퍼 텍스트를 `absolute bottom-0`으로 배치하여 전회 정보 유무에 상관없이 부모 래퍼의 레이아웃 높이를 일치시킨다.
  2. Input 컴포넌트 자체의 기본 스타일로 `h-11 md:h-10` 및 `py-2 text-base md:text-sm`을 내재화하여 프로젝트 내부의 모든 활성/비활성 입력 필드 높이를 40px(모바일 44px)로 완벽히 통일한다.
  3. 캘린더 아이콘 버튼을 Absolute로 배치할 경우, 부모는 단순 `relative`로 두고 버튼에는 `top-1/2 -translate-y-1/2`를 명시하여 정확한 세로 중앙에 오도록 고정한다.
  4. 글로벌 CSS 파일에서 텍스트를 치우치게 만들던 `padding-bottom: 2px !important` 강제 지정을 완전히 제거하여 입력 문자가 상하 균등한 패딩 비율로 세로 정중앙에 렌더링되게 한다.

### 2. [2026-06-27] UI 진입 경로에 불필요하게 명칭이 중복/길어지는 현상
* **원인:**
  1. 헤더 영역 메모장 버튼의 `title` 속성이 "지청 메모장"으로 지정되어 있었으나, 실제 해당 버튼의 목적에 비해 텍스트가 다소 길어 가시성이 떨어짐.
* **해결법:**
  1. 단순하고 명료한 사용자 경험을 위해 타이틀 문구를 "메모장"으로 간소화함.

### 3. [2026-06-27] 신규 사업장 등록 시 국고지원여부 누락 현상 및 데이터 제약 오류
* **원인:**
  1. 신규 사업장 등록 모달 폼과 API POST 핸들러에 국고지원여부(`national_support_status`) 관련 필드가 누락되어 있어, 신규 등록 시 국고지원을 선택할 수 없었음.
  2. 과거 국고지원 상태 값 중 `'지원'`이라는 텍스트가 데이터베이스의 체크 제약조건(`CHECK IN ('대상', '비대상')`)과 일치하지 않아 오류가 날 우려가 있었음.
* **해결법:**
  1. `MeasurementTargetBusinessManagement.tsx` 모달 UI 내 계획담당 옆에 국고지원여부 셀렉트(대상/비대상)를 배치하고, 등록 및 폼 리셋 로직을 추가함.
  2. `/api/businesses/route.ts` API POST 메소드가 `national_support_status` 값을 전달받아 DB에 정상적으로 삽입할 수 있도록 쿼리를 보강함.

### 4. 매출 상세 현황 대표자명 필터링 미작동 오류 (v0.2.1)
* **오류 현황:** 매출관리 > 매출 상세 현황 > 측정비 탭에서 '대표자명'을 입력하고 Enter 또는 Blur 조회를 시도했을 때, 데이터 검색이 재트리거되지 않고 먹통인 현상 발생.
* **원인:** `SalesManagement.tsx` 컴포넌트 내에서 필터 상태(`measurementFilters`)의 변경을 감지하여 데이터를 패치하는 `useEffect` 훅의 의존성 배열(Dependency Array)에 `measurementFilters.representativeName` 변수가 누락되어 있었음. 이로 인해 대표자명 필터 상태가 변해도 데이터 리로드 로직이 수행되지 않음.
* **해결 방법:** `useEffect` 의존성 배열에 `measurementFilters.representativeName`을 추가하여 필터 변경 감지 및 데이터 재조회가 즉각 트리거되도록 수정 완료.
* **재발 방지 대책:** 
  - 컴포넌트 상태 필터링 또는 검색 기능을 구현할 때, 상태 값 변경이 트리거되어야 하는 모든 패치 `useEffect` 의존성 배열에 관련 상태 속성이 빠짐없이 명시되어 있는지 크로스 체크할 것.
  - 특히, 여러 검색 항목이 결합된 복합 필터 객체(`filters`)의 경우 각 개별 필드들의 변경 감지 여부를 확인해야 함.

### 5. imapflow 라이브러리 누락 및 타입 에러로 인한 전체 빌드 중단 (v0.2.2)
* **오류 현황:** 로컬 개발 환경에서 Next.js 실행 및 컴파일 도중 `Module not found: Can't resolve 'imapflow'` 에러와 함께 타입 오류(`Property 'length' does not exist on type 'false | number[]'`)가 겹치며 API 라우트들이 전부 500 내부 서버 에러를 뱉고 멈추는 현상 발생.
* **원인:**
  1. `package.json`에는 `imapflow` 라이브러리가 정의되어 있으나 로컬 패키지 설치(`npm install`)가 온전히 되지 않아 모듈을 찾을 수 없는 상태였음.
  2. `lib/email/bounce-checker.ts` 파일 내 `client.search()` 함수의 반환값인 `messages` 변수가 `false` 또는 `number[]` 타입을 가질 수 있음에도, 이에 대한 타입 가드(Type Guard) 없이 `messages.length` 및 이터레이터를 직접 호출하여 타입 에러 발생.
* **해결 방법:**
  1. `npm install`을 실행하여 로컬 환경에 필요한 모듈 패키지를 완전 재설치함.
  2. `bounce-checker.ts` 코드 내에 `!messages` 조건을 추가하여 `messages`가 `false`로 반환되었을 때의 타입 예외 처리를 정밀 보강함.
* **재발 방지 대책:**
  - 외부 라이브러리 연계 및 복잡한 반환 타입을 다루는 서브 모듈 개발 시, 예외 반환 형태(`false`, `null` 등)에 대한 타입 가드 방어코드를 반드시 추가할 것.
  - 패키지 누락으로 인한 빌드 경고 발생 시 터미널 전체 로그 및 브라우저 컴파일 화면을 조기 크로스체크해 패키지 설치 상태를 우선적으로 검사할 것.

### 6. imapflow의 experimental.serverComponentsExternalPackages 누락으로 인한 Turbopack 빌드 실패 (v0.2.3)
* **오류 현황:** `npm install` 및 타입 에러 해결 이후에도 Next.js Turbopack 개발 서버 실행 시 여전히 `Module not found: Can't resolve 'imapflow'` 빌드 에러가 지속되는 현상 발생.
* **원인:** `imapflow`는 Node.js 네이티브 네트워크 기능을 사용하는 백엔드 전용 모듈임. Next.js 14 환경(특히 Turbopack 모드)에서 이를 별도의 외부 패키지로 지정하지 않으면, 컴파일러가 이를 프론트엔드/클라이언트 코드로 번들링하려고 시도하며 모듈 해석 실패 에러를 유발함.
* **해결 방법:** `next.config.mjs`의 `experimental.serverComponentsExternalPackages` 배열 내에 `'imapflow'`를 명시하여 번들러 해석 대상에서 직접 제외되도록 설정함.
* **재발 방지 대책:**
  - Node.js 전용 네이티브 라이브러리(imapflow, node-cron, pg 등)를 신규 연동하는 경우, 반드시 `next.config.mjs`의 `serverComponentsExternalPackages` 배열에 함께 등록해주어야 웹팩/터보팩 번들링 시 모듈 누락 오류를 원천 차단할 수 있음.

### 7. 미수관리 탭 대표자명 검색 기능 구현 누락 오류 (v0.2.4)
* **오류 현황:** 매출 상세 현황 > 미수관리 탭에서 대표자명을 입력하여 검색할 수 있는 수단이 제공되지 않고 테이블 헤더가 단순히 `-` 기호로 고정되어 있었음.
* **원인:** 미수관리 필터 상태(`unpaidFilters`)와 로컬 입력 검색어 상태에 `representativeName` 항목이 전혀 정의되어 있지 않았으며, 수집된 미수금 데이터인 `unpaidItems`에서 대표자명 필드(`representative`) 매칭을 확인하는 필터링 가드가 적용되지 않았음.
* **해결 방법:**
  1. `unpaidFilters` 및 로컬 상태에 대표자명을 담을 프로퍼티들을 추가함.
  2. 미수금 메모리 필터링 영역(`unpaidItems.filter(...)`)에 `unpaidFilters.representativeName` 필터링 검증 가드를 추가함.
  3. 미수관리 UI 테이블 헤더의 대표자 컬럼 영역에 대표자명 `Input` 컴포넌트를 이식하여 실시간 엔터/포커스아웃 시 검색 처리가 되도록 마크업을 보완함.
* **재발 방지 대책:**
  - 테이블 형태의 정보 대시보드를 구성할 때, 탭이나 화면 간에 공통적으로 맵핑되는 핵심 검색 필터 항목들(예: 사업장명, 대표자명, 지정지청 등)이 누락 없이 모든 화면 탭의 헤더 필터에 통일성 있게 제공되는지 요구사항 분석 단계에서 사전에 체크리스트화하여 검증할 것.
