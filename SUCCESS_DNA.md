# SUCCESS DNA

## MISTAKE LOG (실수 로그)

### 1. 매출 상세 현황 대표자명 필터링 미작동 오류 (v0.2.1)
* **오류 현황:** 매출관리 > 매출 상세 현황 > 측정비 탭에서 '대표자명'을 입력하고 Enter 또는 Blur 조회를 시도했을 때, 데이터 검색이 재트리거되지 않고 먹통인 현상 발생.
* **원인:** `SalesManagement.tsx` 컴포넌트 내에서 필터 상태(`measurementFilters`)의 변경을 감지하여 데이터를 패치하는 `useEffect` 훅의 의존성 배열(Dependency Array)에 `measurementFilters.representativeName` 변수가 누락되어 있었음. 이로 인해 대표자명 필터 상태가 변해도 데이터 리로드 로직이 수행되지 않음.
* **해결 방법:** `useEffect` 의존성 배열에 `measurementFilters.representativeName`을 추가하여 필터 변경 감지 및 데이터 재조회가 즉각 트리거되도록 수정 완료.
* **재발 방지 대책:** 
  - 컴포넌트 상태 필터링 또는 검색 기능을 구현할 때, 상태 값 변경이 트리거되어야 하는 모든 패치 `useEffect` 의존성 배열에 관련 상태 속성이 빠짐없이 명시되어 있는지 크로스 체크할 것.
  - 특히, 여러 검색 항목이 결합된 복합 필터 객체(`filters`)의 경우 각 개별 필드들의 변경 감지 여부를 확인해야 함.

### 2. imapflow 라이브러리 누락 및 타입 에러로 인한 전체 빌드 중단 (v0.2.2)
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

### 3. imapflow의 experimental.serverComponentsExternalPackages 누락으로 인한 Turbopack 빌드 실패 (v0.2.3)
* **오류 현황:** `npm install` 및 타입 에러 해결 이후에도 Next.js Turbopack 개발 서버 실행 시 여전히 `Module not found: Can't resolve 'imapflow'` 빌드 에러가 지속되는 현상 발생.
* **원인:** `imapflow`는 Node.js 네이티브 네트워크 기능을 사용하는 백엔드 전용 모듈임. Next.js 14 환경(특히 Turbopack 모드)에서 이를 별도의 외부 패키지로 지정하지 않으면, 컴파일러가 이를 프론트엔드/클라이언트 코드로 번들링하려고 시도하며 모듈 해석 실패 에러를 유발함.
* **해결 방법:** `next.config.mjs`의 `experimental.serverComponentsExternalPackages` 배열 내에 `'imapflow'`를 명시하여 번들러 해석 대상에서 직접 제외되도록 설정함.
* **재발 방지 대책:**
  - Node.js 전용 네이티브 라이브러리(imapflow, node-cron, pg 등)를 신규 연동하는 경우, 반드시 `next.config.mjs`의 `serverComponentsExternalPackages` 배열에 함께 등록해주어야 웹팩/터보팩 번들링 시 모듈 누락 오류를 원천 차단할 수 있음.

### 4. 미수관리 탭 대표자명 검색 기능 구현 누락 오류 (v0.2.4)
* **오류 현황:** 매출 상세 현황 > 미수관리 탭에서 대표자명을 입력하여 검색할 수 있는 수단이 제공되지 않고 테이블 헤더가 단순히 `-` 기호로 고정되어 있었음.
* **원인:** 미수관리 필터 상태(`unpaidFilters`)와 로컬 입력 검색어 상태에 `representativeName` 항목이 전혀 정의되어 있지 않았으며, 수집된 미수금 데이터인 `unpaidItems`에서 대표자명 필드(`representative`) 매칭을 확인하는 필터링 가드가 적용되지 않았음.
* **해결 방법:**
  1. `unpaidFilters` 및 로컬 상태에 대표자명을 담을 프로퍼티들을 추가함.
  2. 미수금 메모리 필터링 영역(`unpaidItems.filter(...)`)에 `unpaidFilters.representativeName` 필터링 검증 가드를 추가함.
  3. 미수관리 UI 테이블 헤더의 대표자 컬럼 영역에 대표자명 `Input` 컴포넌트를 이식하여 실시간 엔터/포커스아웃 시 검색 처리가 되도록 마크업을 보완함.
* **재발 방지 대책:**
  - 테이블 형태의 정보 대시보드를 구성할 때, 탭이나 화면 간에 공통적으로 맵핑되는 핵심 검색 필터 항목들(예: 사업장명, 대표자명, 지정지청 등)이 누락 없이 모든 화면 탭의 헤더 필터에 통일성 있게 제공되는지 요구사항 분석 단계에서 사전에 체크리스트화하여 검증할 것.
