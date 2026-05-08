# Technical Concerns - 측정일지 관리 시스템

## 1. Logic Fragmentation (High)
- **Issue**: Numerous standalone scripts in `scripts/`, `scratch/`, and root (`simulate-recovery.ts`, `find-corrupted.ts`, etc.).
- **Impact**: Knowledge fragmentation. Critical logic for data recovery and validation is not integrated into the main application.
- **Goal**: Consolidate useful scripts into a unified `lib/maintenance` or `lib/admin` module.

## 2. Large File Complexity (Medium)
- **Issue**: Some files (like legacy sync logic) are excessively long (over 1000 lines).
- **Impact**: High risk of regression during modification.
- **Goal**: Refactor large modules into smaller, testable sub-modules.

## 3. Automation Fragility (Medium)
- **Issue**: Reliance on Selenium for external system interaction is susceptible to UI changes in target portals.
- **Impact**: Frequent maintenance required for automation tasks.
- **Goal**: Implement more robust error handling and monitoring for Selenium tasks.

## 4. UI/UX Consistency (Low)
- **Issue**: Ongoing localization of the Knowledge Graph (`graphify`).
- **Impact**: Potential parity issues between English and Korean versions.
- **Goal**: Maintain the synchronization script (`translate_graph_ko.py`) as the master localization tool.

## 5. Security (Critical Check)
- **Issue**: Presence of `google-credentials.json` and `.env.local` in the workspace.
- **Impact**: Risk of accidental exposure.
- **Action**: Ensure these are strictly excluded from version control and handled via secure environment variables in production.
