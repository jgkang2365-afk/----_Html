# Implementation Plan - 업종 분류 숫자 데이터 정정

`business_category` 필드에 포함된 레거시 숫자 코드들을 식별하고, 사용자가 수동으로 정정할 수 있도록 리스트를 추출하고 정정 가이드를 제공합니다.

## 1. 현황 분석 (Forest Phase)
- `measurement_target_business`, `measurement_journal`, `measurement_business` 테이블에서 `business_category` 값이 숫자인 레코드를 전수 조사합니다.
- 현재 존재하는 비표준 값(숫자)의 종류와 빈도를 파악합니다.

## 2. 상호작용 매핑 및 기록 (Tree Phase)
- 숫자 코드별로 전체 사업장 리스트를 제시하고 사용자의 매핑 정보를 수집합니다.
- 수집된 매핑 정보는 `scratch/category_mapping.json`에 영구 기록하여 유실을 방지합니다.

## 3. 정정 스크립트 작성 및 승인 (Tree Phase)
- 모든 매핑이 완료되면 `category_mapping.json`을 기반으로 한 **일괄 업데이트 스크립트**를 작성합니다.
- 스크립트 실행 전, 변경될 데이터의 예상 결과(Dry-run 결과)를 사용자에게 보고하고 **최종 승인**을 받습니다.

## 4. 실행 및 사후 검증 (Forest Phase)
- 승인된 스크립트를 실제 DB에 적용합니다.
- 적용 후 숫자가 포함된 데이터가 잔존하는지 재검토하여 0건임을 보증합니다.

## 4. 사후 검증 (Verification)
- 정정 작업 후 다시 조사를 실행하여 숫자가 포함된 데이터가 잔존하는지 확인합니다.

---
**주의사항**: "Zero-Hallucination DB Protocol"에 따라 반드시 실제 DB 조회를 통해 리스트를 작성합니다.
