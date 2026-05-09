# System Architecture - 측정일지 관리 시스템

## 1. Architectural Pattern
- **Pattern**: Next.js App Router (Modular Full-Stack).
- **Core Principle**: Separation of Concerns (Business logic in `lib/`, UI in `app/`).
- **Data Flow**: Uni-directional flow (Supabase -> Server Components -> Client Components -> User).

## 2. Layers
### 2.1 UI Layer (`app/`)
- **Modules**:
  - `(auth)`: Login and registration.
  - `(dashboard)`: Core management interfaces.
  - `admin`: System-level administrative tools.
  - `journal`: Measurement journal management.
  - `sales`: Sales and payment tracking.
  - `survey`: Feedback/Survey modules.
- **Layouts**: Global layout defined in `app/layout.tsx`.

### 2.2 Business Logic Layer (`lib/`)
- **`db/`**: Schema-specific query logic.
- **`sync/`**: Complex data synchronization (Excel <-> DB).
- **`automation/`**: Selenium-based automation tasks.
- **`google/`**: API wrappers for Sheets/Drive.
- **`scheduler/`**: Background job logic (via `node-cron`).

### 2.3 Data Layer (Supabase)
- **PostgreSQL**: Relational storage for businesses, users, and measurement logs.
- **Schema**: Managed via `schema.sql`.

## 3. Key Design Decisions
- **Server-Side Rendering (SSR)**: Used for initial page loads and SEO.
- **Client-Side Interactivity**: Used for complex forms and graphs (vis.js).
- **Hybrid Data Source**: Combines relational DB (Supabase) with static/exported data (Excel).
- **ID-Based Background Fetch**: Modals now prioritize ID-based direct API calls (`/api/journal/[id]`) over list-state objects to ensure data integrity and latest state.
- **Real-time Business Logic**: Complex calculations (e.g., measurement fee summation) are enforced via client-side `useEffect` and re-validated server-side during `PATCH` operations.

## 4. Entry Points
- **Web**: `app/page.tsx` (Main entry).
- **API**: `app/api/` (Serverless endpoints).
- **Scripts**: `scripts/` (Maintenance and initialization).
