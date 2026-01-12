# HTML5 Date Input 필드 구현 가이드

## 문제 분석: 반복되는 날짜 입력 오류

### 발생한 문제들
1. **잘못된 날짜 형식 표시**: "202601-01-일" 같은 이상한 형식
2. **Backspace 키 작동 안 함**: 입력 필드가 제어되지 않음
3. **종료일 자동 설정 안 됨**: 측정일 변경 시 종료일이 업데이트되지 않음

### 근본 원인
1. **HTML5 date input의 value 형식 불일치**
   - HTML5 `type="date"` input은 **오직** `YYYY-MM-DD` 형식 또는 빈 문자열(`""`)만 허용
   - 다른 형식의 값이 들어가면 브라우저가 로컬화를 시도하면서 이상한 형식 표시
   - 잘못된 형식의 값이 들어가면 입력 필드가 제어되지 않음

2. **값 정규화 누락**
   - 초기 데이터 로드 시 정규화가 누락되거나 불완전함
   - onChange 핸들러에서 값 검증 부족
   - formData에 잘못된 형식의 값이 저장됨

3. **상태 관리 문제**
   - useEffect 의존성 배열 문제로 자동 업데이트가 작동하지 않음
   - 변수 선언 순서 문제로 초기화 전 접근 시도

---

## 해결 방법 및 베스트 프랙티스

### 1. HTML5 Date Input의 기본 원칙

```typescript
// ✅ 올바른 사용법
<input 
  type="date" 
  value={dateValue || ""}  // 항상 YYYY-MM-DD 형식이거나 빈 문자열
  onChange={(e) => {
    // HTML5 date input은 항상 YYYY-MM-DD 형식으로 값을 반환
    const normalizedValue = e.target.value; // 이미 정규화됨
    setDateValue(normalizedValue);
  }}
/>

// ❌ 잘못된 사용법
<input 
  type="date" 
  value={someOtherFormat}  // 다른 형식의 값 사용 금지
  onChange={(e) => {
    // 추가 변환 없이 그대로 사용
  }}
/>
```

### 2. 날짜 값 정규화 함수

```typescript
/**
 * 날짜 값을 YYYY-MM-DD 형식으로 정규화
 * HTML5 date input에 사용하기 위한 함수
 * 
 * 규칙:
 * 1. 빈 값(null, undefined, 빈 문자열)은 빈 문자열 반환
 * 2. 이미 YYYY-MM-DD 형식이면 그대로 반환 (유효성 검사 포함)
 * 3. 다른 형식은 파싱 시도 후 YYYY-MM-DD로 변환
 * 4. 파싱 실패 시 빈 문자열 반환 (잘못된 값 방지)
 */
export function normalizeDateForInput(dateValue: string | null | undefined): string {
  if (!dateValue) return "";
  
  const strValue = String(dateValue).trim();
  if (!strValue) return "";

  // 이미 YYYY-MM-DD 형식인 경우 (정확한 형식 체크)
  if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
    // 유효한 날짜인지 확인
    const date = new Date(strValue + "T00:00:00"); // 시간대 문제 방지
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const normalized = `${year}-${month}-${day}`;
      // 원본과 일치하는지 확인
      if (normalized === strValue) {
        return normalized;
      }
    }
  }

  // YYYYMMDD 형식 (8자리 숫자만)
  const numbersOnly = strValue.replace(/[^\d]/g, "");
  if (numbersOnly.length === 8) {
    const year = numbersOnly.substring(0, 4);
    const month = numbersOnly.substring(4, 6);
    const day = numbersOnly.substring(6, 8);
    const normalized = `${year}-${month}-${day}`;
    // 유효한 날짜인지 확인
    const date = new Date(normalized + "T00:00:00");
    if (!isNaN(date.getTime())) {
      const checkYear = date.getFullYear();
      const checkMonth = String(date.getMonth() + 1).padStart(2, "0");
      const checkDay = String(date.getDate()).padStart(2, "0");
      if (`${checkYear}-${checkMonth}-${checkDay}` === normalized) {
        return normalized;
      }
    }
  }

  // Date 객체로 파싱 시도
  const date = new Date(strValue);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // 파싱 실패 시 빈 문자열 반환 (잘못된 값 방지)
  return "";
}
```

### 3. React 컴포넌트 구현 패턴

```typescript
// ✅ 올바른 구현 패턴
const [formData, setFormData] = useState({
  measurement_date: "",
  end_date: "",
});

// 1. 변수 선언 (useEffect보다 먼저)
const [endDateManuallyModified, setEndDateManuallyModified] = useState(false);

// 2. 초기 데이터 로드 시 정규화
useEffect(() => {
  if (initialData) {
    const normalizedMeasurementDate = normalizeDateForInput(initialData.measurement_date);
    const normalizedEndDate = normalizeDateForInput(initialData.end_date);
    
    setFormData({
      ...formData,
      ...initialData,
      measurement_date: normalizedMeasurementDate,
      end_date: normalizedEndDate || normalizedMeasurementDate,
    });
    
    if (normalizedMeasurementDate && !normalizedEndDate) {
      setEndDateManuallyModified(false);
    } else if (normalizedEndDate) {
      setEndDateManuallyModified(true);
    }
  }
}, [initialData]);

// 3. 측정일 변경 시 종료일 자동 설정 (변수 선언 이후)
useEffect(() => {
  if (formData.measurement_date && !endDateManuallyModified && !formData.end_date) {
    setFormData((prev) => ({ ...prev, end_date: prev.measurement_date }));
  }
}, [formData.measurement_date, endDateManuallyModified]);

// 4. onChange 핸들러 (값 검증 불필요 - HTML5 date input이 이미 정규화됨)
const handleMeasurementDateChange = (value: string) => {
  // HTML5 date input은 항상 YYYY-MM-DD 형식으로 값을 반환하므로 그대로 사용
  setFormData((prev) => {
    const updated = { ...prev, measurement_date: value };
    
    // 종료일 자동 설정
    if (!endDateManuallyModified && (!prev.end_date || prev.end_date === prev.measurement_date)) {
      updated.end_date = value;
    }
    
    return updated;
  });
};

// 5. JSX에서 value prop 사용 (정규화된 값만 사용)
<Input
  type="date"
  value={formData.measurement_date || ""}  // 빈 문자열 fallback
  onChange={(e) => handleMeasurementDateChange(e.target.value)}
/>
```

### 4. 체크리스트

날짜 입력 필드를 구현할 때 다음을 확인하세요:

- [ ] **value prop 검증**
  - [ ] 항상 `YYYY-MM-DD` 형식이거나 빈 문자열(`""`)인가?
  - [ ] `normalizeDateForInput` 함수를 사용하여 정규화했는가?
  - [ ] 빈 값일 때 빈 문자열 fallback을 사용했는가?

- [ ] **onChange 핸들러**
  - [ ] HTML5 date input이 반환하는 값을 그대로 사용하는가?
  - [ ] 추가 변환 없이 직접 저장하는가?
  - [ ] 값 검증이 필요한가? (일반적으로 불필요 - HTML5가 처리)

- [ ] **초기 데이터 로드**
  - [ ] `useEffect`에서 초기 데이터를 정규화하는가?
  - [ ] 정규화된 값만 formData에 저장하는가?

- [ ] **상태 관리**
  - [ ] 변수 선언 순서가 올바른가? (useState → useEffect)
  - [ ] useEffect 의존성 배열이 올바른가?
  - [ ] 무한 루프를 방지하는가?

- [ ] **자동 업데이트 로직**
  - [ ] 종료일이 측정일의 기본값을 가지는가?
  - [ ] useEffect가 올바른 위치에 있는가?
  - [ ] 의존성 배열이 올바른가?

### 5. 자주 하는 실수

#### ❌ 실수 1: value prop에 정규화하지 않은 값 사용
```typescript
// 잘못된 예
<Input type="date" value={formData.measurement_date} />
// formData.measurement_date가 "20260101" 같은 형식이면 오류 발생
```

#### ✅ 올바른 예
```typescript
<Input type="date" value={normalizeDateForInput(formData.measurement_date) || ""} />
```

#### ❌ 실수 2: onChange에서 추가 변환
```typescript
// 잘못된 예
onChange={(e) => {
  const date = new Date(e.target.value);
  const formatted = date.toISOString().split('T')[0];
  setDate(formatted);
}}
// 불필요한 변환 - HTML5 date input이 이미 올바른 형식으로 반환
```

#### ✅ 올바른 예
```typescript
onChange={(e) => {
  setDate(e.target.value); // 그대로 사용
}}
```

#### ❌ 실수 3: 변수 선언 전 useEffect 사용
```typescript
// 잘못된 예
useEffect(() => {
  if (!endDateManuallyModified) { // 오류 발생!
    // ...
  }
}, []);

const [endDateManuallyModified, setEndDateManuallyModified] = useState(false);
```

#### ✅ 올바른 예
```typescript
const [endDateManuallyModified, setEndDateManuallyModified] = useState(false);

useEffect(() => {
  if (!endDateManuallyModified) {
    // ...
  }
}, [endDateManuallyModified]);
```

---

## 구현 검증 체크리스트

날짜 입력 필드를 구현한 후 다음을 테스트하세요:

1. **기본 기능**
   - [ ] 날짜 선택기가 정상 작동하는가?
   - [ ] 선택한 날짜가 `YYYY-MM-DD` 형식으로 표시되는가?
   - [ ] Backspace 키가 정상 작동하는가?
   - [ ] 입력 필드를 지울 수 있는가?

2. **초기값 설정**
   - [ ] 초기 데이터가 올바른 형식으로 표시되는가?
   - [ ] 잘못된 형식의 초기 데이터가 빈 필드로 표시되는가?

3. **자동 업데이트**
   - [ ] 측정일 변경 시 종료일이 자동으로 업데이트되는가?
   - [ ] 종료일을 수동으로 수정한 후 측정일 변경 시 종료일이 유지되는가?

4. **에러 처리**
   - [ ] 잘못된 형식의 값이 들어와도 앱이 크래시하지 않는가?
   - [ ] 빈 값이 올바르게 처리되는가?

---

## 요약

**핵심 원칙:**
1. HTML5 date input의 value는 **항상** `YYYY-MM-DD` 형식이거나 빈 문자열이어야 함
2. onChange에서 받은 값은 **그대로** 사용 (HTML5가 이미 정규화함)
3. 초기 데이터 로드 시 **반드시** 정규화 함수 사용
4. 변수 선언 순서 준수 (useState → useEffect)
5. 빈 값일 때 빈 문자열 fallback 사용

**절대 하지 말아야 할 것:**
1. ❌ value prop에 정규화하지 않은 값 사용
2. ❌ onChange에서 불필요한 변환
3. ❌ 변수 선언 전 useEffect 사용
4. ❌ 잘못된 형식의 값을 formData에 저장
