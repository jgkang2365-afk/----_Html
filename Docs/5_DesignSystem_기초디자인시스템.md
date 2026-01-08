# Design System (기초 디자인 시스템)

**프로젝트명**: 측정일지 관리 시스템  
**버전**: v1.0  
**작성일**: 2025-01-27

---

## 1. 디자인 원칙

### 1.1 핵심 원칙
- **간단하고 직관적**: Excel의 복잡한 메뉴 대신 명확하고 직접적인 인터페이스
- **명확한 피드백**: 모든 작업에 대한 즉각적인 피드백 제공
- **일관성**: 모든 화면에서 일관된 디자인 패턴 유지
- **접근성**: 키보드 탐색 가능, 색상 대비 충분, 포커스 링 명확

### 1.2 참고 서비스
- **구글 시트**: 깔끔하고 직관적인 테이블 인터페이스
- **트렐로**: 간단한 카드 기반 레이아웃, 명확한 액션 버튼

---

## 2. 색상 팔레트

### 2.1 역할 기반 색상 정의

#### Primary (주요 액션)
- **Primary 500**: `#3B82F6` (파란색) - 주요 버튼, 링크
- **Primary 600**: `#2563EB` (호버 상태)
- **Primary 700**: `#1D4ED8` (활성 상태)

#### Secondary (보조 액션)
- **Secondary 500**: `#6B7280` (회색) - 보조 버튼
- **Secondary 600**: `#4B5563` (호버 상태)

#### Success (성공/완료)
- **Success 500**: `#10B981` (초록색) - 성공 메시지, 완료 상태
- **Success 600**: `#059669` (호버 상태)

#### Warning (경고)
- **Warning 500**: `#F59E0B` (주황색) - 경고 메시지, 주의 필요
- **Warning 600**: `#D97706` (호버 상태)

#### Error (오류)
- **Error 500**: `#EF4444` (빨간색) - 오류 메시지, 삭제 버튼
- **Error 600**: `#DC2626` (호버 상태)

#### Surface (표면/배경)
- **Surface 0**: `#FFFFFF` (흰색) - 메인 배경
- **Surface 50**: `#F9FAFB` (연한 회색) - 카드 배경
- **Surface 100**: `#F3F4F6` (회색) - 구분선, 테두리

#### Text (텍스트)
- **Text 900**: `#111827` (거의 검은색) - 주요 텍스트
- **Text 700**: `#374151` (진한 회색) - 보조 텍스트
- **Text 500**: `#6B7280` (회색) - 비활성 텍스트
- **Text 300**: `#D1D5DB` (연한 회색) - 플레이스홀더

### 2.2 색상 대비 (접근성)

모든 텍스트와 배경의 대비비는 WCAG AA 기준 이상 유지:
- **일반 텍스트**: 최소 4.5:1
- **큰 텍스트 (18pt 이상)**: 최소 3:1
- **인터랙티브 요소**: 최소 3:1

---

## 3. 타이포그래피

### 3.1 폰트 패밀리

- **기본 폰트**: 시스템 폰트 스택
  ```css
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  ```
- **모노스페이스**: 코드, 번호 표시
  ```css
  font-family: 'Courier New', Courier, monospace;
  ```

### 3.2 타이포그래피 스케일

| 스타일 | 크기 | 행간 | 용도 |
|--------|------|------|------|
| H1 | 32px (2rem) | 1.2 | 페이지 제목 |
| H2 | 24px (1.5rem) | 1.3 | 섹션 제목 |
| H3 | 20px (1.25rem) | 1.4 | 하위 섹션 제목 |
| H4 | 18px (1.125rem) | 1.5 | 카드 제목 |
| Body Large | 16px (1rem) | 1.5 | 본문 (큰 텍스트) |
| Body | 14px (0.875rem) | 1.5 | 본문 (기본) |
| Body Small | 12px (0.75rem) | 1.5 | 보조 텍스트, 캡션 |
| Label | 14px (0.875rem) | 1.4 | 폼 레이블 |
| Button | 14px (0.875rem) | 1.4 | 버튼 텍스트 |

### 3.3 폰트 굵기

- **Regular (400)**: 기본 텍스트
- **Medium (500)**: 강조 텍스트, 레이블
- **Semibold (600)**: 제목, 중요 정보
- **Bold (700)**: 강한 강조

---

## 4. 간격 시스템

### 4.1 기본 간격 단위

8px 기준 그리드 시스템 사용:

| 이름 | 크기 | 용도 |
|------|------|------|
| xs | 4px (0.25rem) | 매우 작은 간격 |
| sm | 8px (0.5rem) | 작은 간격 |
| md | 16px (1rem) | 기본 간격 |
| lg | 24px (1.5rem) | 큰 간격 |
| xl | 32px (2rem) | 매우 큰 간격 |
| 2xl | 48px (3rem) | 섹션 간격 |
| 3xl | 64px (4rem) | 페이지 간격 |

### 4.2 적용 예시

- **카드 내부 패딩**: md (16px)
- **카드 간 간격**: lg (24px)
- **섹션 간 간격**: xl (32px)
- **폼 요소 간 간격**: md (16px)
- **버튼 내부 패딩**: sm (8px) 수평, md (16px) 수직

---

## 5. 기본 UI 컴포넌트

### 5.1 버튼 (Button)

#### Primary Button
- **기본 상태**: 
  - 배경: Primary 500 (#3B82F6)
  - 텍스트: 흰색
  - 패딩: 12px 24px
  - 둥근 모서리: 6px
  - 그림자: 없음
- **호버 상태**: 
  - 배경: Primary 600 (#2563EB)
  - 커서: pointer
- **활성 상태**: 
  - 배경: Primary 700 (#1D4ED8)
- **비활성 상태**: 
  - 배경: Surface 100 (#F3F4F6)
  - 텍스트: Text 500 (#6B7280)
  - 커서: not-allowed

#### Secondary Button
- **기본 상태**: 
  - 배경: 투명
  - 테두리: 1px solid Secondary 500 (#6B7280)
  - 텍스트: Secondary 500 (#6B7280)
  - 패딩: 12px 24px
  - 둥근 모서리: 6px
- **호버 상태**: 
  - 배경: Surface 50 (#F9FAFB)
  - 테두리: Secondary 600 (#4B5563)
  - 텍스트: Secondary 600 (#4B5563)

#### Danger Button
- **기본 상태**: 
  - 배경: Error 500 (#EF4444)
  - 텍스트: 흰색
- **호버 상태**: 
  - 배경: Error 600 (#DC2626)

### 5.2 입력 필드 (Input)

#### Text Input
- **기본 상태**: 
  - 배경: 흰색
  - 테두리: 1px solid Surface 100 (#F3F4F6)
  - 패딩: 12px 16px
  - 둥근 모서리: 6px
  - 폰트: Body (14px)
- **포커스 상태**: 
  - 테두리: 2px solid Primary 500 (#3B82F6)
  - 아웃라인: 없음
- **에러 상태**: 
  - 테두리: 2px solid Error 500 (#EF4444)
- **비활성 상태**: 
  - 배경: Surface 50 (#F9FAFB)
  - 텍스트: Text 500 (#6B7280)
  - 커서: not-allowed

#### Select (드롭다운)
- Text Input과 동일한 스타일
- 오른쪽에 화살표 아이콘 표시

#### Textarea
- Text Input과 동일한 스타일
- 최소 높이: 100px
- 리사이즈: 수직만 가능

### 5.3 카드 (Card)

- **배경**: 흰색
- **테두리**: 1px solid Surface 100 (#F3F4F6)
- **둥근 모서리**: 8px
- **그림자**: 0 1px 3px rgba(0, 0, 0, 0.1)
- **패딩**: 24px
- **호버 상태** (클릭 가능한 카드): 
  - 그림자: 0 4px 6px rgba(0, 0, 0, 0.1)
  - 커서: pointer

### 5.4 테이블 (Table)

- **헤더**: 
  - 배경: Surface 50 (#F9FAFB)
  - 텍스트: Text 700 (#374151), Semibold (600)
  - 패딩: 12px 16px
  - 테두리 하단: 2px solid Surface 100 (#F3F4F6)
- **셀**: 
  - 패딩: 12px 16px
  - 테두리 하단: 1px solid Surface 100 (#F3F4F6)
- **호버 행**: 
  - 배경: Surface 50 (#F9FAFB)
- **선택 행**: 
  - 배경: Primary 50 (매우 연한 파란색)

### 5.5 알림 (Alert)

#### Success Alert
- **배경**: Success 50 (매우 연한 초록색)
- **테두리**: 1px solid Success 500 (#10B981)
- **아이콘**: Success 500 (#10B981)
- **텍스트**: Text 900 (#111827)

#### Warning Alert
- **배경**: Warning 50 (매우 연한 주황색)
- **테두리**: 1px solid Warning 500 (#F59E0B)
- **아이콘**: Warning 500 (#F59E0B)
- **텍스트**: Text 900 (#111827)

#### Error Alert
- **배경**: Error 50 (매우 연한 빨간색)
- **테두리**: 1px solid Error 500 (#EF4444)
- **아이콘**: Error 500 (#EF4444)
- **텍스트**: Text 900 (#111827)

### 5.6 모달 (Modal)

- **오버레이**: rgba(0, 0, 0, 0.5) - 반투명 검은색
- **모달 박스**: 
  - 배경: 흰색
  - 둥근 모서리: 12px
  - 최대 너비: 600px
  - 패딩: 24px
  - 그림자: 0 20px 25px rgba(0, 0, 0, 0.15)
- **닫기 버튼**: 오른쪽 상단, X 아이콘

### 5.7 탭 (Tab)

- **기본 탭**: 
  - 텍스트: Text 700 (#374151)
  - 테두리 하단: 2px solid transparent
  - 패딩: 12px 16px
- **활성 탭**: 
  - 텍스트: Primary 500 (#3B82F6)
  - 테두리 하단: 2px solid Primary 500 (#3B82F6)
  - 폰트: Semibold (600)
- **호버 탭**: 
  - 배경: Surface 50 (#F9FAFB)

---

## 6. 레이아웃

### 6.1 그리드 시스템

12열 그리드 시스템 사용:
- **컨테이너 최대 너비**: 1200px
- **컨테이너 패딩**: 좌우 24px
- **그리드 간격**: 24px

### 6.2 반응형 브레이크포인트

| 이름 | 크기 | 용도 |
|------|------|------|
| Mobile | < 640px | 모바일 |
| Tablet | 640px - 1024px | 태블릿 |
| Desktop | > 1024px | 데스크톱 |

### 6.3 네비게이션

- **사이드바 너비**: 240px (데스크톱)
- **상단 헤더 높이**: 64px
- **하단 푸터 높이**: 48px (선택적)

---

## 7. 아이콘

### 7.1 아이콘 라이브러리

- **Heroicons**: 기본 아이콘 세트 사용
- **크기**: 20px (기본), 24px (큰 아이콘)
- **색상**: Text 700 (#374151) 기본, Primary 500 (#3B82F6) 활성

### 7.2 주요 아이콘

- **검색**: MagnifyingGlassIcon
- **저장**: CheckIcon
- **취소**: XMarkIcon
- **편집**: PencilIcon
- **삭제**: TrashIcon
- **다운로드**: ArrowDownTrayIcon
- **업로드**: ArrowUpTrayIcon
- **알림**: BellIcon
- **설정**: Cog6ToothIcon

---

## 8. 애니메이션

### 8.1 전환 효과

- **기본 전환**: 150ms ease-in-out
- **호버 전환**: 200ms ease-in-out
- **모달 전환**: 300ms ease-out

### 8.2 사용 제한

- **과도한 애니메이션 금지**: 사용자 경험을 방해하지 않도록 최소화
- **성능 고려**: GPU 가속 가능한 속성만 사용 (transform, opacity)

---

## 9. 접근성 체크리스트

### 9.1 색상 대비
- ✅ 모든 텍스트와 배경의 대비비 4.5:1 이상
- ✅ 인터랙티브 요소의 대비비 3:1 이상

### 9.2 키보드 탐색
- ✅ 모든 인터랙티브 요소에 포커스 링 표시
- ✅ Tab 순서가 논리적
- ✅ 키보드만으로 모든 기능 사용 가능

### 9.3 포커스 링
- **색상**: Primary 500 (#3B82F6)
- **두께**: 2px
- **스타일**: solid
- **오프셋**: 2px (요소와의 간격)

### 9.4 스크린 리더
- ✅ 모든 이미지에 alt 텍스트
- ✅ 폼 요소에 적절한 label
- ✅ 의미론적 HTML 사용 (header, nav, main, footer 등)

---

## 10. 다크 모드 (선택적)

현재 버전에서는 다크 모드 미지원. 향후 확장 가능하도록 색상 변수 사용 권장.

---

## 11. 컴포넌트 라이브러리

### 11.1 권장 라이브러리

- **Tailwind CSS**: 유틸리티 기반 CSS 프레임워크
- **Headless UI**: 접근성 고려된 컴포넌트 (선택적)
- **React Hook Form**: 폼 관리 및 검증

### 11.2 커스텀 컴포넌트

위의 디자인 시스템을 기반으로 다음 커스텀 컴포넌트 구현:
- Button (Primary, Secondary, Danger)
- Input (Text, Select, Textarea)
- Card
- Table
- Alert (Success, Warning, Error)
- Modal
- Tab
- Loading Spinner
- Empty State

---

## 12. 디자인 토큰 (Design Tokens)

### 12.1 색상 토큰

```css
:root {
  /* Primary */
  --color-primary-500: #3B82F6;
  --color-primary-600: #2563EB;
  --color-primary-700: #1D4ED8;
  
  /* Secondary */
  --color-secondary-500: #6B7280;
  --color-secondary-600: #4B5563;
  
  /* Success */
  --color-success-500: #10B981;
  --color-success-600: #059669;
  
  /* Warning */
  --color-warning-500: #F59E0B;
  --color-warning-600: #D97706;
  
  /* Error */
  --color-error-500: #EF4444;
  --color-error-600: #DC2626;
  
  /* Surface */
  --color-surface-0: #FFFFFF;
  --color-surface-50: #F9FAFB;
  --color-surface-100: #F3F4F6;
  
  /* Text */
  --color-text-900: #111827;
  --color-text-700: #374151;
  --color-text-500: #6B7280;
  --color-text-300: #D1D5DB;
}
```

### 12.2 간격 토큰

```css
:root {
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --spacing-3xl: 64px;
}
```

### 12.3 타이포그래피 토큰

```css
:root {
  --font-size-h1: 32px;
  --font-size-h2: 24px;
  --font-size-h3: 20px;
  --font-size-h4: 18px;
  --font-size-body-large: 16px;
  --font-size-body: 14px;
  --font-size-body-small: 12px;
  --font-size-label: 14px;
  --font-size-button: 14px;
  
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
}
```

