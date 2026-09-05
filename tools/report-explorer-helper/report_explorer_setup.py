"""Entry point packaged as the one-time ReportExplorerSetup.exe."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from report_explorer_update_runtime import (
    UpdateEngine,
    UpdateError,
    UpdateLock,
    _assert_safe_install_tree,
    _configure_logger,
    _load_config,
    _safe_unlink,
    paths_for_current_user,
    register_updater_autostart,
    write_config,
)
from report_explorer_versions import SETUP_VERSION


def _bundled_updater() -> Path:
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    candidate = bundle_root / "ReportExplorerUpdater.exe"
    if not candidate.is_file() or candidate.is_symlink() or candidate.read_bytes()[:2] != b"MZ":
        raise UpdateError("Bundled updater executable is missing or invalid")
    return candidate


def _install_bundled_updater() -> None:
    paths = paths_for_current_user()
    _assert_safe_install_tree(paths, create=True)
    source = _bundled_updater()
    staged = paths.updater.with_suffix(".exe.new")
    _safe_unlink(staged, paths)
    try:
        staged.write_bytes(source.read_bytes())
        if staged.read_bytes()[:2] != b"MZ":
            raise UpdateError("Bundled updater copy failed PE validation")
        os.replace(staged, paths.updater)
    finally:
        _safe_unlink(staged, paths)


def main() -> int:
    paths = paths_for_current_user()
    logger = _configure_logger(paths)
    try:
        with UpdateLock():
            logger.info("setup_start setup_version=%s", SETUP_VERSION)
            _install_bundled_updater()
            channel, current_version = _load_config(paths)
            write_config(paths, channel, current_version)
            result = UpdateEngine(paths).run(acquire_lock=False)
            register_updater_autostart(paths)
            logger.info("setup_final_status=%s helper_version=%s", result.status, result.helper_version)
        return 0
    except UpdateError as error:
        logger.error("setup_final_status=failed error=%s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
