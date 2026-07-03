# Instructions for AI Agents

This project has strict security configurations in `.npmrc` to prevent supply chain attacks.

## Common Issues & Solutions

### 1. "Package age is below minimum" errors
If `npm install` fails because a package version is too new:
- Do NOT repeatedly retry the installation.
- Check if an older, stable version (older than 7 days) can be used.
- If a newer version is absolutely necessary, inform the user so they can temporarily disable `min-release-age` in `.npmrc`.

### 2. Post-install script failures
If a package requires an install script (blocked by `ignore-scripts=true`):
- Verify if the script is safe.
- Inform the user that the package installation is incomplete and requires manual verification of scripts.

## 3. 브라우저 테스트 계정 정보 (Test Credentials)
브라우저에 접속하여 자동 및 수동 테스트를 수행할 때는 아래의 테스트 계정 정보를 사용하여 로그인해야 합니다.
- **사용자 이름 (Name):** `test`
- **비밀번호 (Password):** `@0000@`
- **역할 (Role):** `관리자` (Administrator)

