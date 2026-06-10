# Coding Conventions - 측정일지 관리 시스템

## 1. General Principles
- **TypeScript First**: Ensure all new code is strictly typed.
- **Component Decomposition**: Keep components small and focused.
- **Separation of Concerns**: UI components should not contain complex business logic.

## 2. Naming Conventions
- **Files**: 
  - Components: PascalCase (`JournalTable.tsx`)
  - Hooks: camelCase starting with 'use' (`useJournal.ts`)
  - Utils/Lib: kebab-case or camelCase (`excel-sync.ts`)
- **Variables**: camelCase (`currentBusiness`).
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRY_COUNT`).

## 3. Code Style
- **Indentation**: 2 spaces.
- **Quotes**: Single quotes for JS/TS, double quotes for JSX.
- **Linting**: Enforced via ESLint and Prettier.
- **Tailwind**: Follow standard class ordering (e.g., layout -> size -> colors).

## 4. Error Handling
- **Async/Await**: Use try-catch blocks with meaningful error logging.
- **API Responses**: Standardize response formats (success/error/data).
- **User Feedback**: Use `sonner` for non-intrusive error notifications.

## 5. UI/UX Principles
- **Aesthetics**: Premium, modern design using Tailwind.
- **Responsiveness**: Mobile-first design where applicable.
- **Localization**: Use Korean as the primary language for user-facing text.
