---
description: Verify the Excel synchronization fix for manager mobile numbers
---

1. Clear Next.js cache and start the development server
// turbo
npm run dev:clean

2. Open the application in the browser
   - URL: http://localhost:3000
   - Login if required (admin/admin1234!)

3. Navigate to "측정 대상 사업장 관리" (Measurement Target Business Management)
   - Click functionality in the navigation bar.

4. Click "측정 대상 사업장 목록 엑셀 업로드" button
   - Select the updated `측정사업장.xlsx` file.
   - Wait for the "업로드 및 동기화 완료" toast or message.

5. Verify the data
   - Check the "담당자 info" column for a business that previously had an issue.
   - Ensure the mobile number is formatted correctly (e.g., 010-XXXX-XXXX).
   - Ensure "직위" (Position) values are NOT in the mobile number field.
