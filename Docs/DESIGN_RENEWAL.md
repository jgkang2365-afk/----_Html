# UI/UX 디자인 리뉴얼 기획서

## 1. 개요 (Overview)

### 1.1 배경 및 문제점
*   **가독성 저하**: 현재 테이블 내 텍스트 크기가 작아, 노안이 있거나 시력이 낮은 사용자가 정보를 확인하는 데 어려움이 있음.
*   **공간 효율성 부족**: 테이블 셀(Cell) 간격이 불필요하게 넓어, 한 화면에 표시되는 정보량이 적고 시선 이동이 잦음.
*   **디자인 노후화**: 기본적인 스타일만 적용되어 있어, 사용자에게 최신 웹 애플리케이션의 경험(UX)을 제공하지 못함.

### 1.2 목표 (Goal)
1.  **시각적 접근성 강화 (Accessibility)**: 글꼴 크기 확대 및 명료한 대비(Contrast) 적용.
2.  **정보 밀도 최적화 (Information Density)**: 테이블 레이아웃을 'Compact'하면서도 답답하지 않게 조정.
3.  **심미적 고도화 (Modern Aesthetics)**: Glassmorphism, Soft Shadow 등 최신 트렌드를 반영한 UI 구축.

---

## 2. 디자인 시스템 전략

### 2.1 타이포그래피 (Typography)
노안 사용자 배려를 위해 기본 폰트 사이즈를 **1단계(2px) 상향** 조정합니다.

*   **Font Family**: `Pretendard` (가독성이 우수한 산세리프 서체) 또는 시스템 기본 폰트.
*   **Size Scale**:
    *   **Body (본문)**: 14px → **16px**
    *   **Table Data (표 데이터)**: 13px → **15px** (가장 중요한 데이터)
    *   **Table Header (표 헤더)**: 13px → **15px** (Bold)
    *   **Button Text**: 14px → **16px**
    *   **Small (주석 등)**: 12px → **14px**
*   **Weight**: 중요한 정보는 굵기(Bold/Semibold)를 통해 계층을 명확히 함.

### 2.2 컬러 팔레트 (Color Palette)
눈의 피로를 최소화하면서도 세련된 느낌을 주는 컬러 사용.

*   **Primary**: 모던한 딥 블루 (기존보다 채도를 약간 낮추고 명도를 조절).
*   **Background**: 순백색(#FFFFFF)보다는 미세한 쿨 그레이(#F8FAFC)를 베이스로 사용.
*   **Text**:
    *   Primary: #1E293B (완전 검정 대신 짙은 네이비 그레이)
    *   Secondary: #64748B (설명 텍스트)
*   **Border**: #E2E8F0 (연하고 부드러운 구분선)

---

## 3. UI 컴포넌트 상세 기획

### 3.1 데이터 테이블 (Data Table)
가장 많은 데이터를 다루는 핵심 컴포넌트로, **가독성**과 **집중도**를 최우선으로 함.

*   **Style**:
    *   **Card Style Container**: 테이블 전체를 감싸는 둥근 모서리(Rounded-xl)와 은은한 그림자(Shadow-sm) 적용.
    *   **Sticky Header**: 스크롤 시 헤더를 상단에 고정하고, `backdrop-filter: blur(8px)` 효과로 본문 위로 떠 있는 느낌 구현.
    *   **Row Height**: 불필요한 상하 패딩을 줄이되(`py-3` 정도), 텍스트 줄간격(`leading-relaxed`)을 확보하여 빽빽해 보이지 않게 함.
    *   **Hover Effect**: 마우스 오버 시 행 배경색을 부드럽게 변경(#F1F5F9)하여 현재 읽고 있는 라인을 명확히 함.
    *   **Border**: 세로 구분선은 제거하고 가로 구분선만 남겨 시선 흐름을 방해하지 않음.

### 3.2 모달 (Modal / Dialog)
사용자에게 깊이감을 주는 최신 트렌드 적용.

*   **Backdrop**: 배경을 단순히 어둡게 하는 것뿐만 아니라 **블러 처리(Blur-sm)**하여 뒤의 콘텐츠를 흐릿하게 만듦 (집중도 향상).
*   **Container**:
    *   **Glassmorphism**: 반투명한 흰색 배경 + 미세한 테두리 광택.
    *   **Animation**: 중앙에서 부드럽게 커지며 나타나는 `Scale-up` + `Fade-in` 애니메이션.
    *   **Rounded**: 모서리를 크게 둥글게 처리 (Rounded-2xl).
*   **Action Area**: 모달 하단 버튼 영역을 명확히 분리하되, 여백을 충분히 둠.

### 3.3 버튼 (Button)
클릭하고 싶은 질감과 명확한 피드백 제공.

*   **Shape**: 완전한 사각형보다는 약간 둥근 형태 (Rounded-lg) 또는 알약 형태(Pill shape) 사용.
*   **Effect**:
    *   **Normal**: Solid 컬러 또는 미세한 그라데이션. 약한 그림자(Shadow-sm).
    *   **Hover**: 살짝 떠오르는 느낌(Translate-y)과 그림자 강화(Shadow-md). 밝기 증가.
    *   **Active(Click)**: 눌리는 느낌(Scale down).
*   **Target Size**: 노안 사용자를 위해 터치/클릭 영역(Padding)을 넉넉히 확보 (`px-6 py-2.5` 이상).

### 3.4 폼 요소 (Input, Select)
*   **Height**: 입력창 높이를 키워(42px 이상) 텍스트가 시원하게 보이도록 함.
*   **Focus**: 포커스 시 테두리 색상 변경과 함께 부드러운 `Ring` 효과(Glow) 추가.

---

## 4. 적용 예시 (Implementation Changes)

| 구분 | 기존 (Before) | 변경 (After) | 기대 효과 |
| :--- | :--- | :--- | :--- |
| **글씨 크기** | 13~14px | **15~16px** | 눈의 피로 감소, 가독성 확보 |
| **테이블 간격** | 넓고 산만함 | **Compact & Organized** | 정보 응집도 향상, 스크롤 감소 |
| **디자인 톤** | 플랫(Flat), 기본 | **Modern, Depth** | 고급스러운 사용자 경험, 업무 만족도 향상 |
| **테랙션** | 없음/단순 색반전 | **Micro-interaction** | 조작의 즐거움, 명확한 피드백 |

## 5. 실행 계획
1.  **Global Style Update**: `tailwind.config.ts` 및 `globals.css`에서 기본 폰트 사이즈 및 컬러 팔레트 재정의.
2.  **Component Refactoring**: `Table.tsx`, `Modal.tsx`, `Button.tsx` 순으로 스타일 업데이트.
3.  **Page Layout**: 주요 페이지(대시보드, 목록 등)에 새로운 컴포넌트 적용 및 레이아웃 간격 조정.
