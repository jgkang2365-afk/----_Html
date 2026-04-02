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
