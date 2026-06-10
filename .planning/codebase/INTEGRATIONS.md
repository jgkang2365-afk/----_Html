# External Integrations - 측정일지 관리 시스템

## 1. Primary Backend: Supabase
- **Role**: Database, Authentication, and Session Management.
- **Integration**: `@supabase/supabase-js`, `@supabase/ssr`.
- **Environment**: `.env.local` (SUPABASE_URL, SUPABASE_ANON_KEY).

## 2. Cloud Platform: Vercel
- **Role**: Hosting, Serverless Functions, and Deployment pipeline.
- **Integration**: `vercel.json` configuration.

## 3. Google Workspace
- **Services**: Google Sheets, Google Drive.
- **Integration**: `googleapis` (v171+).
- **Credentials**: `google-credentials.json`.
- **Usage**: Exporting reports and syncing measurement data.

## 4. Email Services
- **SMTP/IMAP**: `nodemailer`, `imapflow`.
- **Usage**: Sending notifications and fetching measurement-related emails for automated parsing.

## 5. File Formats
- **Excel (.xlsx)**: `xlsx` (SheetJS).
- **CSV**: Node.js filesystem and Python CSV modules.
- **Usage**: Importing business target lists and exporting measurement journals.

## 6. Automation Targets
- **K2B / External Systems**: `selenium-webdriver`.
- **Usage**: Automating data entry/retrieval from legacy government/corporate portals.

## 7. Knowledge Graph
- **Vis.js**: Network visualization for dependency mapping.
- **Graphify**: Tool used to generate architecture maps from code structure.
