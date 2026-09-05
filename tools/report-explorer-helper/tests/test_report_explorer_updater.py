"""Focused safety tests for Setup/Updater without touching a user profile or registry."""

from __future__ import annotations

import hashlib
from contextlib import nullcontext
import logging
import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HELPER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPER_DIR))
runtime = importlib.import_module("report_explorer_update_runtime")
setup = importlib.import_module("report_explorer_setup")
versions = importlib.import_module("report_explorer_versions")


class FakeProcess:
    def poll(self):
        return None


class FakeProcesses:
    def __init__(self, running: bool = False) -> None:
        self.running = running
        self.stopped: list[Path] = []

    def matching_pids(self, executable: Path) -> list[int]:
        return [41] if self.running else []

    def stop_exact(self, executable: Path) -> None:
        self.stopped.append(executable)
        self.running = False


class FakeReleaseClient:
    def __init__(self, release, data: bytes, error: Exception | None = None) -> None:
        self.release = release
        self.data = data
        self.error = error
        self.downloads = 0

    def latest(self, _channel: str):
        if self.error:
            raise self.error
        return self.release

    def download_helper(self, _release, destination: Path) -> None:
        self.downloads += 1
        destination.write_bytes(self.data)


class UpdateRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.paths = runtime.paths_for_current_user(self.tempdir.name)
        runtime._assert_safe_install_tree(self.paths, create=True)
        self.data = b"MZ" + (b"release-helper" * 10_000)
        self.release = runtime.Release(
            "stable",
            "1.0.1",
            "1",
            hashlib.sha256(self.data).hexdigest(),
            len(self.data),
            "https://github.com/jgkang2365-afk/----_Html/releases/download/report-explorer-helper-v1.0.1/ReportExplorerHelper.exe",
        )

    def tearDown(self) -> None:
        logger = logging.getLogger("report_explorer_updater")
        for handler in list(logger.handlers):
            handler_path = getattr(handler, "baseFilename", None)
            if handler_path and runtime._is_within(Path(handler_path), self.paths.root):
                logger.removeHandler(handler)
                handler.close()
        self.tempdir.cleanup()

    def make_engine(self, client, processes=None, health=None):
        controller = processes or FakeProcesses()

        def start(_paths):
            controller.running = True
            return FakeProcess()

        return runtime.UpdateEngine(
            self.paths,
            release_client=client,
            process_controller=controller,
            starter=start,
            health_waiter=health or (lambda _process, _version: True),
        )
    def test_release_version_is_the_single_component_source(self) -> None:
        self.assertEqual({versions.RELEASE_VERSION, versions.HELPER_VERSION, versions.UPDATER_VERSION, versions.SETUP_VERSION}, {versions.RELEASE_VERSION})


    def test_semver_and_channel_tag_are_strict(self) -> None:
        self.assertEqual(runtime.parse_semver("1.20.3"), (1, 20, 3))
        self.assertEqual(runtime.helper_tag("stable", "1.0.1"), "report-explorer-helper-v1.0.1")
        self.assertEqual(runtime.helper_tag("pilot", "1.0.1"), "report-explorer-helper-pilot-v1.0.1")
        for value in ("1.0", "v1.0.0", "01.0.0", "1.0.0-beta"):
            with self.subTest(value=value):
                with self.assertRaises(runtime.UpdateError):
                    runtime.parse_semver(value)

    def test_release_client_filters_stable_and_pilot_tags(self) -> None:
        def asset(name: str, tag: str) -> dict[str, str]:
            return {"name": name, "browser_download_url": f"https://github.com/jgkang2365-afk/----_Html/releases/download/{tag}/{name}"}

        stable_tag = "report-explorer-helper-v1.0.1"
        pilot_tag = "report-explorer-helper-pilot-v1.0.2"
        releases = [
            {"tag_name": stable_tag, "draft": False, "prerelease": False, "assets": [asset("ReportExplorerHelper.exe", stable_tag), asset("ReportExplorerSetup.exe", stable_tag), asset("SHA256SUMS.txt", stable_tag), asset("release.json", stable_tag)]},
            {"tag_name": pilot_tag, "draft": False, "prerelease": True, "assets": [asset("ReportExplorerHelper.exe", pilot_tag), asset("ReportExplorerSetup.exe", pilot_tag), asset("SHA256SUMS.txt", pilot_tag), asset("release.json", pilot_tag)]},
        ]
        manifest = {"channel": "stable", "releaseTag": stable_tag, "sourceCommit": "c" * 40, "releaseVersion": "1.0.1", "protocolVersion": "1", "helperVersion": "1.0.1", "updaterVersion": "1.0.1", "setupVersion": "1.0.1", "helperSha256": "a" * 64, "helperSize": runtime.MIN_HELPER_SIZE_BYTES, "setupSha256": "b" * 64, "setupSize": runtime.MIN_HELPER_SIZE_BYTES}
        sums = ("a" * 64 + "  ReportExplorerHelper.exe\n" + "b" * 64 + "  ReportExplorerSetup.exe\n").encode()
        with patch.object(runtime, "_read_https", side_effect=[json.dumps(releases).encode(), json.dumps(manifest).encode(), sums]):
            stable = runtime.GitHubReleaseClient().latest("stable")
        self.assertEqual(stable.helper_version, "1.0.1")
        pilot_manifest = dict(manifest, channel="pilot", releaseTag=pilot_tag, releaseVersion="1.0.2", helperVersion="1.0.2", updaterVersion="1.0.2", setupVersion="1.0.2")
        with patch.object(runtime, "_read_https", side_effect=[json.dumps(releases).encode(), json.dumps(pilot_manifest).encode(), sums]):
            pilot = runtime.GitHubReleaseClient().latest("pilot")
        self.assertEqual(pilot.helper_version, "1.0.2")
        mismatched = dict(pilot_manifest, setupVersion="9.9.9")
        with patch.object(runtime, "_read_https", side_effect=[json.dumps(releases).encode(), json.dumps(mismatched).encode(), sums]):
            with self.assertRaises(runtime.UpdateError):
                runtime.GitHubReleaseClient().latest("pilot")

    def test_sha_failure_keeps_existing_helper_untouched(self) -> None:
        self.paths.helper.write_bytes(b"old-helper")
        runtime.write_config(self.paths, "stable", "1.0.0")
        invalid = FakeReleaseClient(self.release, b"MZbad")
        with self.assertRaises(runtime.UpdateError):
            self.make_engine(invalid).run()
        self.assertEqual(self.paths.helper.read_bytes(), b"old-helper")
        self.assertFalse(self.paths.candidate.exists())
        self.assertFalse(self.paths.download.exists())

    def test_outdated_helper_downloads_replaces_and_updates_config(self) -> None:
        self.paths.helper.write_bytes(b"old-helper")
        runtime.write_config(self.paths, "stable", "1.0.0")
        processes = FakeProcesses(running=True)
        result = self.make_engine(FakeReleaseClient(self.release, self.data), processes).run()
        self.assertEqual(result.status, "updated")
        self.assertEqual(self.paths.helper.read_bytes(), self.data)
        self.assertEqual(processes.stopped, [self.paths.helper])
        self.assertEqual(runtime._load_config(self.paths), ("stable", "1.0.1"))
        self.assertFalse(self.paths.previous.exists())

    def test_new_helper_health_failure_rolls_back_and_restarts_previous(self) -> None:
        self.paths.helper.write_bytes(b"old-helper")
        runtime.write_config(self.paths, "stable", "1.0.0")
        expected_versions: list[str | None] = []

        processes = FakeProcesses(running=True)
        def health(_process, expected):
            expected_versions.append(expected)
            return expected is None

        with self.assertRaises(runtime.UpdateError):
            self.make_engine(FakeReleaseClient(self.release, self.data), processes=processes, health=health).run()
        self.assertEqual(self.paths.helper.read_bytes(), b"old-helper")
        self.assertFalse(self.paths.previous.exists())
        self.assertEqual(expected_versions, ["1.0.1", None])
        self.assertEqual(processes.stopped, [self.paths.helper, self.paths.helper])

    def test_previous_restore_failure_is_reported_as_rollback_failed(self) -> None:
        self.paths.helper.write_bytes(b"old-helper")
        runtime.write_config(self.paths, "stable", "1.0.0")
        processes = FakeProcesses(running=True)
        original_replace = runtime.os.replace

        def failing_restore(source, destination):
            if Path(source) == self.paths.previous and Path(destination) == self.paths.helper:
                raise OSError("restore denied")
            return original_replace(source, destination)

        def health(_process, expected):
            return expected is None

        with patch.object(runtime.os, "replace", side_effect=failing_restore):
            with self.assertRaises(runtime.UpdateError) as caught:
                self.make_engine(FakeReleaseClient(self.release, self.data), processes=processes, health=health).run()
        self.assertIn("ROLLBACK_FAILED", str(caught.exception))
        self.assertTrue(self.paths.previous.exists())
        self.assertFalse(self.paths.helper.exists())
    def test_network_failure_starts_the_existing_helper_without_download(self) -> None:
        self.paths.helper.write_bytes(b"old-helper")
        runtime.write_config(self.paths, "stable", "1.0.0")
        client = FakeReleaseClient(self.release, self.data, runtime.UpdateError("timeout"))
        result = self.make_engine(client).run()
        self.assertEqual(result.status, "helper_started")
        self.assertEqual(client.downloads, 0)

    def test_missing_helper_installs_from_verified_release(self) -> None:
        result = self.make_engine(FakeReleaseClient(self.release, self.data)).run()
        self.assertEqual(result.status, "updated")
        self.assertEqual(self.paths.helper.read_bytes(), self.data)

    def test_storage_root_unavailable_is_healthy_when_listener_and_protocol_match(self) -> None:
        payload = {"status": "ok", "version": "1", "helperVersion": "1.0.1", "storage": {"available": False, "reason": "STORAGE_ROOT_UNAVAILABLE"}}
        with patch.object(runtime, "_health_once", return_value=payload):
            self.assertTrue(runtime.helper_is_healthy("1.0.1"))
        payload["version"] = "2"
        with patch.object(runtime, "_health_once", return_value=payload):
            self.assertFalse(runtime.helper_is_healthy("1.0.1"))
    def _run_setup(self, argv: list[str]) -> tuple[int, dict[str, object]]:
        observed: dict[str, object] = {}

        class FakeEngine:
            def __init__(inner, paths):
                observed["paths"] = paths
            def run(inner, *, acquire_lock=True):
                observed["channel"] = runtime._load_config(self.paths)[0]
                return runtime.UpdateResult("updated", versions.RELEASE_VERSION)

        with (
            patch.object(setup, "paths_for_current_user", return_value=self.paths),
            patch.object(setup, "UpdateLock", return_value=nullcontext()),
            patch.object(setup, "_install_bundled_updater"),
            patch.object(setup, "UpdateEngine", FakeEngine),
            patch.object(setup, "register_updater_autostart", side_effect=lambda paths: observed.update(registered=paths)),
        ):
            code = setup.main(argv)
        return code, observed

    def test_setup_defaults_to_stable_channel(self) -> None:
        code, observed = self._run_setup([])
        self.assertEqual(code, 0)
        self.assertEqual(observed["channel"], "stable")

    def test_clean_setup_can_bootstrap_explicit_pilot_channel(self) -> None:
        self.assertFalse(self.paths.config.exists())
        code, observed = self._run_setup(["--channel", "pilot"])
        self.assertEqual(code, 0)
        self.assertEqual(observed["channel"], "pilot")

    def test_setup_rejects_unknown_channels(self) -> None:
        for channel in ("beta", "preview"):
            with self.subTest(channel=channel), self.assertRaises(SystemExit):
                setup._parse_args(["--channel", channel])

    def test_update_lock_rejects_duplicate_owner(self) -> None:
        with runtime.UpdateLock():
            with self.assertRaises(runtime.UpdateInProgress):
                with runtime.UpdateLock():
                    pass

    def test_update_runtime_has_no_explorer_or_arbitrary_registry_target(self) -> None:
        boundary = "\n".join(
            (HELPER_DIR / name).read_text(encoding="utf-8")
            for name in ("report_explorer_update_runtime.py", "report_explorer_setup.py", "report_explorer_updater.py")
        )
        for forbidden in ("taskkill", "explorer.exe", "Quick Access", "AutomaticDestinations", "CustomDestinations", "MapNetworkDrive", "New-PSDrive", "OneDrive"):
            self.assertNotIn(forbidden, boundary)
        self.assertIn('RUN_VALUE = "MeasurementJournalReportExplorerHelper"', boundary)
        self.assertIn('RUN_KEY = r"Software\\Microsoft\\Windows\\CurrentVersion\\Run"', boundary)


if __name__ == "__main__":
    unittest.main()
