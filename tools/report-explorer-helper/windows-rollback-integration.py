"""Run an actual Windows EXE-lock rollback in an isolated LocalAppData tree."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

HELPER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HELPER_DIR))

import report_explorer_update_runtime as runtime  # noqa: E402

FIXTURE_SERVER = """import socket,sys
body = b'{"status":"ok","version":"fixture"}'
reply = b'HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: ' + str(len(body)).encode() + b'\\r\\nConnection: close\\r\\n\\r\\n' + body
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(('127.0.0.1', int(sys.argv[1])))
server.listen()
while True:
    client, _ = server.accept()
    client.recv(4096); client.sendall(reply); client.close()
"""


class LocalReleaseClient:
    def __init__(self, release: runtime.Release, helper_source: Path) -> None:
        self.release = release
        self.helper_source = helper_source

    def latest(self, channel: str) -> runtime.Release:
        if channel != self.release.channel:
            raise runtime.UpdateError("Unexpected integration-test channel")
        return self.release

    def download_helper(self, _release: runtime.Release, destination: Path) -> None:
        shutil.copyfile(self.helper_source, destination)


class EvidenceProcessController(runtime.WindowsProcessController):
    def __init__(self, evidence: dict[str, object]) -> None:
        self.evidence = evidence

    def stop_exact(self, executable: Path) -> None:
        before = self.matching_pids(executable)
        exact_before = [
            pid
            for pid in before
            if runtime._path_equal(self._process_path(pid) or Path("."), executable)
        ]
        super().stop_exact(executable)
        after = self.matching_pids(executable)
        stops = self.evidence.setdefault("stopEvents", [])
        assert isinstance(stops, list)
        stops.append(
            {
                "path": str(executable),
                "pids": exact_before,
                "remainingPids": after,
            }
        )
        if after:
            raise AssertionError(f"Exact-path helper PIDs survived stop: {after}")


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _fixture_is_healthy(port: int) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as response:
            payload = json.loads(response.read(1024))
    except (OSError, TimeoutError, json.JSONDecodeError):
        return False
    return payload == {"status": "ok", "version": "fixture"}


def _close_runtime_logger(paths: runtime.InstallPaths) -> None:
    logger = logging.getLogger("report_explorer_updater")
    for handler in list(logger.handlers):
        handler_path = getattr(handler, "baseFilename", None)
        if handler_path and runtime._is_within(Path(handler_path), paths.root):
            logger.removeHandler(handler)
            handler.close()


def run() -> dict[str, object]:
    if os.name != "nt":
        raise RuntimeError("This integration test requires Windows")
    port = _free_loopback_port()
    helper_source = Path(sys.executable)

    temp_parent = Path(os.environ.get("RUNNER_TEMP", r"C:\tmp"))
    temp_parent.mkdir(parents=True, exist_ok=True)
    prior_local_app_data = os.environ.get("LOCALAPPDATA")
    evidence: dict[str, object] = {
        "windowsExeLock": False,
        "failedHelperRemovedBeforeRestore": False,
        "previousRestoredAtomically": False,
        "previousHelperHealth": False,
    }

    with tempfile.TemporaryDirectory(prefix="report-explorer-rollback-", dir=temp_parent) as temp:
        os.environ["LOCALAPPDATA"] = temp
        paths = runtime.paths_for_current_user()
        runtime._assert_safe_install_tree(paths, create=True)
        old_bytes = helper_source.read_bytes()
        old_sha256 = hashlib.sha256(old_bytes).hexdigest()
        paths.helper.write_bytes(old_bytes)
        runtime.write_config(paths, "stable", "1.0.0")

        release_version = "9.9.9"
        release = runtime.Release(
            "stable",
            release_version,
            runtime.PROTOCOL_VERSION,
            old_sha256,
            len(old_bytes),
            "https://github.com/jgkang2365-afk/----_Html/releases/download/"
            f"report-explorer-helper-v{release_version}/{runtime.HELPER_FILENAME}",
        )
        controller = EvidenceProcessController(evidence)
        candidate_pid: int | None = None
        restored_pid: int | None = None
        original_unlink = runtime._safe_unlink
        original_replace = runtime.os.replace

        def tracked_unlink(path: Path, install_paths: runtime.InstallPaths) -> None:
            if runtime._path_equal(path, paths.helper) and path.exists():
                if controller.matching_pids(paths.helper):
                    raise AssertionError("Failed helper removal was attempted before process exit")
                evidence["failedHelperRemovedBeforeRestore"] = True
            original_unlink(path, install_paths)

        def tracked_replace(source: str | os.PathLike[str], destination: str | os.PathLike[str]) -> None:
            if runtime._path_equal(Path(source), paths.previous) and runtime._path_equal(Path(destination), paths.helper):
                if not evidence["failedHelperRemovedBeforeRestore"] or paths.helper.exists():
                    raise AssertionError("Previous helper restore happened before failed EXE removal")
                original_replace(source, destination)
                evidence["previousRestoredAtomically"] = True
                return
            original_replace(source, destination)

        def health_waiter(process: runtime.StartedProcess, expected_version: str | None) -> bool:
            nonlocal candidate_pid, restored_pid
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                pids = controller.matching_pids(paths.helper)
                if pids and runtime.helper_is_healthy(None):
                    if expected_version == release_version:
                        candidate_pid = pids[0]
                        evidence["candidatePid"] = candidate_pid
                        evidence["candidateExactPath"] = runtime._path_equal(
                            controller._process_path(candidate_pid) or Path("."), paths.helper
                        )
                        evidence["windowsExeLock"] = True
                        return False
                    restored_pid = pids[0]
                    evidence["restoredPid"] = restored_pid
                    evidence["previousHelperHealth"] = True
                    return True
                if process.poll() is not None:
                    return False
                time.sleep(0.1)
            return False

        runtime._safe_unlink = tracked_unlink
        runtime.os.replace = tracked_replace
        try:
            engine = runtime.UpdateEngine(
                paths,
                release_client=LocalReleaseClient(release, helper_source),
                process_controller=controller,
                health_waiter=health_waiter,
            )
            try:
                engine.run()
            except runtime.UpdateError as error:
                evidence["expectedUpdateError"] = str(error)
            else:
                raise AssertionError("Forced candidate health mismatch unexpectedly succeeded")

            restored_sha256 = hashlib.sha256(paths.helper.read_bytes()).hexdigest()
            evidence["restoredSha256"] = restored_sha256
            evidence["config"] = runtime._load_config(paths)
            evidence["candidateStopped"] = any(
                candidate_pid in event["pids"] and not event["remainingPids"]
                for event in evidence["stopEvents"]
                if candidate_pid is not None
            )
            evidence["pidReplaced"] = (
                candidate_pid is not None
                and restored_pid is not None
                and candidate_pid != restored_pid
            )

            required = (
                evidence["windowsExeLock"],
                evidence.get("candidateExactPath"),
                evidence.get("candidateStopped"),
                evidence["failedHelperRemovedBeforeRestore"],
                evidence["previousRestoredAtomically"],
                evidence["previousHelperHealth"],
                evidence.get("pidReplaced"),
                restored_sha256 == old_sha256,
                not paths.previous.exists(),
                runtime._load_config(paths) == ("stable", "1.0.0"),
            )
            if not all(required):
                raise AssertionError(f"Rollback evidence incomplete: {evidence}")
            return evidence
        finally:
            runtime._safe_unlink = original_unlink
            runtime.os.replace = original_replace
            try:
                controller.stop_exact(paths.helper)
            finally:
                _close_runtime_logger(paths)
                if prior_local_app_data is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = prior_local_app_data


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, sort_keys=True))
