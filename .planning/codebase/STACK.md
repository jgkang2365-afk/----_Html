# Technology Stack - 측정일지 관리 시스템

## 1. Core Technologies
- **Languages**: 
  - TypeScript (Main Application)
  - Python (Data Processing & Utilities)
  - SQL (PostgreSQL via Supabase)
- **Runtime**: Node.js v20+
- **Framework**: [Next.js](https://nextjs.org/) v14.2.23 (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v3.4.0

## 2. Frontend Dependencies
- **UI Components**: 
  - `lucide-react` (Icons)
  - `sonner` (Toast Notifications)
  - `clsx`, `tailwind-merge` (Class management)
- **Data Visualization**: 
  - `recharts` (Charts)
  - `vis.js` (Architecture Knowledge Graph - External CDN)
- **State & Forms**: React 18 (Server Components & Client Components mix)
- **Utilities**: `date-fns` (Date handling)

## 3. Backend & Infrastructure
- **BaaS**: [Supabase](https://supabase.com/)
  - Auth (Supabase Auth)
  - Database (PostgreSQL)
  - Storage (Bucket management)
- **Deployment**: [Vercel](https://vercel.com/)
- **ORM/Query**: `@supabase/supabase-js`, `pg`

## 4. Automation & Scripts
- **Selenium**: `selenium-webdriver` (External system automation)
- **Email**: `nodemailer`, `imapflow` (Email fetching & sending)
- **Google Ecosystem**: `googleapis` (Sheets, Drive integration)
- **Excel Processing**: `xlsx` (SheetJS)
- **Python Utilities**: 
  - `translate_graph_ko.py` (Graph Localization)
  - `export_business_excel.py` (Business Data Export)

## 5. Development Tools
- **TypeScript**: `tsconfig.json`
- **Linting**: ESLint, Prettier
- **Runner**: `tsx` (TypeScript Execute)
- **GSD Workflow**: `.planning/` and `.gsd/` for autonomous state management.
