# Testing Strategy - 측정일지 관리 시스템

## 1. Current Status
- **Framework**: No formal testing framework (Jest/Vitest) is currently configured in `package.json`.
- **Manual Verification**: Most verification is performed via custom standalone scripts in `scripts/` or `scratch/`.
- **UI Testing**: Performed manually via browser interaction.

## 2. Testing Tools
- **Standalone Scripts**: 
  - `scripts/validate-sync.ts`: Validates Excel synchronization logic.
  - `tsx`: Used to run verification scripts.
- **Selenium**: Potential for automated UI testing (dependency present in `package.json`).

## 3. Recommended Future Strategy
- **Unit Testing**: Introduce `Vitest` for testing `lib/` logic.
- **E2E Testing**: Implement `Playwright` for critical user flows (Login, Journal Entry).
- **Regression Checks**: Automate execution of `validate-sync.ts` in CI/CD pipelines.

## 4. How to Verify Changes
- **Local Dev**: Run `npm run dev` and perform manual UAT.
- **Sync Logic**: Run `npx tsx scripts/validate-sync.ts` after modifying synchronization engines.
- **Graph Visualization**: Use `python translate_graph_ko.py` to verify localization updates.
