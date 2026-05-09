# Directory Structure - 측정일지 관리 시스템

## 1. Top-Level Structure
```text
.
├── app/                # Next.js App Router (Pages, Layouts, APIs)
├── components/         # Shared React Components
├── lib/                # Shared Business Logic & Utilities
├── hooks/              # Custom React Hooks
├── scripts/            # Development & Maintenance Scripts
├── public/             # Static Assets
├── supabase/           # Supabase Configuration & Migrations
├── graphify-out/       # Generated Knowledge Graph Artifacts
├── .planning/          # GSD Project Management Context
└── .gsd/               # GSD Workflow Configuration
```

## 2. Key Directories
### 2.1 `app/` (Application Layer)
- `admin/`: Admin-specific pages.
- `journal/`: Journal entry and view.
- `sales/`: Sales management.
- `api/`: Backend serverless endpoints.

### 2.2 `lib/` (Logic Layer)
- `db/`: Database interaction logic.
- `sync/`: Excel synchronization engine.
- `auth/`: Authentication wrappers.
- `utils.ts`: Global helper functions.

### 2.3 `scripts/` (Maintenance)
- `clear-cache.js`: Cache clearing utility.
- `init-users.ts`: Initial user setup.
- `backup-db.ts`: Database backup logic.

## 3. Configuration Files
- `package.json`: Dependencies and scripts.
- `tsconfig.json`: TypeScript configuration.
- `next.config.mjs`: Next.js configuration.
- `tailwind.config.ts`: Tailwind CSS theme and settings.
- `schema.sql`: Database schema definition.
