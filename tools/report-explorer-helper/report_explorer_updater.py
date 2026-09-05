"""Entry point packaged as ReportExplorerUpdater.exe."""

from __future__ import annotations

import sys

from report_explorer_update_runtime import run_updater


def main() -> int:
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] != "--startup"):
        return 2
    return run_updater()


if __name__ == "__main__":
    raise SystemExit(main())
