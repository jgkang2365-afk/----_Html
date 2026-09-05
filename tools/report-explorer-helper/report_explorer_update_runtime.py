"""Safe per-user install and update runtime for Report Explorer Helper.

This module intentionally has no browser-facing API.  Only the packaged Setup
and Updater executables call it, and all mutable paths are derived from the
current user's LocalAppData folder.
"""

from __future__ import annotations

import ctypes
from contextlib import nullcontext
import hashlib
import json
import logging
import os
import re
import stat
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from report_explorer_versions import PROTOCOL_VERSION, UPDATER_VERSION


PRODUCT_DIRECTORY = Path("MeasurementJournal") / "ReportExplorerHelper"
HELPER_FILENAME = "ReportExplorerHelper.exe"
UPDATER_FILENAME = "ReportExplorerUpdater.exe"
CONFIG_FILENAME = "config.json"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "MeasurementJournalReportExplorerHelper"
ALLOWED_CHANNELS = frozenset({"stable", "pilot"})
REPOSITORY = "jgkang2365-afk/----_Html"
GITHUB_API_URL = f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=30"
DOWNLOAD_HOSTS = frozenset(
    {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com",
    }
)
API_HOSTS = frozenset({"api.github.com"})
MIN_HELPER_SIZE_BYTES = 100_000
MAX_HELPER_SIZE_BYTES = 100_000_000
METADATA_TIMEOUT_SECONDS = 5
DOWNLOAD_TIMEOUT_SECONDS = 20
HEALTH_TIMEOUT_SECONDS = 10
HEALTH_POLL_SECONDS = 0.25
MUTEX_NAME = "Local\\MeasurementJournalReportExplorerUpdater"
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class UpdateError(RuntimeError):
    """An expected installation/update failure which must preserve fallback."""


class UpdateInProgress(UpdateError):
    """Another updater process owns the complete transaction."""


@dataclass(frozen=True)
class InstallPaths:
    root: Path
    helper: Path
    updater: Path
    config: Path
    logs: Path
    update: Path
    download: Path
    candidate: Path
    previous: Path


@dataclass(frozen=True)
class Release:
    channel: str
    helper_version: str
    protocol_version: str
    helper_sha256: str
    helper_size: int
    helper_url: str
    release_version: str = ""
    updater_version: str = ""
    setup_version: str = ""
    setup_sha256: str = ""
    setup_size: int = 0
    setup_url: str = ""


@dataclass(frozen=True)
class UpdateResult:
    status: str
    helper_version: str | None
    rollback: bool = False


class ReleaseClient(Protocol):
    def latest(self, channel: str) -> Release: ...

    def download_helper(self, release: Release, destination: Path) -> None: ...


class ProcessController(Protocol):
    def matching_pids(self, executable: Path) -> list[int]: ...

    def stop_exact(self, executable: Path) -> None: ...


class StartedProcess(Protocol):
    def poll(self) -> int | None: ...


_non_windows_lock = threading.Lock()


def _path_equal(left: Path, right: Path) -> bool:
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def _is_within(candidate: Path, parent: Path) -> bool:
    try:
        return os.path.commonpath([os.path.normcase(str(candidate)), os.path.normcase(str(parent))]) == os.path.normcase(str(parent))
    except ValueError:
        return False


def parse_semver(value: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(value)
    if not match:
        raise UpdateError(f"Invalid semantic version: {value!r}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def helper_tag(channel: str, version: str) -> str:
    parse_semver(version)
    if channel == "stable":
        return f"report-explorer-helper-v{version}"
    if channel == "pilot":
        return f"report-explorer-helper-pilot-v{version}"
    raise UpdateError("Update channel must be stable or pilot")


def paths_for_current_user(local_app_data: str | Path | None = None) -> InstallPaths:
    configured_base = str(local_app_data) if local_app_data is not None else os.environ.get("LOCALAPPDATA", "")
    if not configured_base:
        raise UpdateError("LOCALAPPDATA is unavailable")
    base = Path(configured_base).expanduser()
    base = base.resolve(strict=False)
    root = (base / PRODUCT_DIRECTORY).resolve(strict=False)
    if not _is_within(root, base):
        raise UpdateError("Install directory escapes LOCALAPPDATA")
    return InstallPaths(
        root=root,
        helper=root / HELPER_FILENAME,
        updater=root / UPDATER_FILENAME,
        config=root / CONFIG_FILENAME,
        logs=root / "logs",
        update=root / "update",
        download=root / f"{HELPER_FILENAME}.download",
        candidate=root / f"{HELPER_FILENAME}.new",
        previous=root / f"{HELPER_FILENAME}.previous",
    )


def _assert_safe_install_tree(paths: InstallPaths, *, create: bool) -> None:
    parent = paths.root.parent
    for entry in (parent, paths.root):
        if entry.exists() and entry.is_symlink():
            raise UpdateError(f"Reparse-point install path is not allowed: {entry}")
    if create:
        paths.root.mkdir(parents=True, exist_ok=True)
        paths.logs.mkdir(exist_ok=True)
        paths.update.mkdir(exist_ok=True)
    resolved_root = paths.root.resolve(strict=False)
    if not _path_equal(resolved_root, paths.root):
        raise UpdateError("Install directory must not resolve outside its fixed path")
    for entry in (
        paths.helper,
        paths.updater,
        paths.config,
        paths.logs,
        paths.update,
        paths.download,
        paths.candidate,
        paths.previous,
    ):
        if not _is_within(entry.resolve(strict=False), paths.root):
            raise UpdateError(f"Write outside install directory is forbidden: {entry}")


def _safe_unlink(path: Path, paths: InstallPaths) -> None:
    _assert_safe_install_tree(paths, create=False)
    if not _is_within(path.resolve(strict=False), paths.root):
        raise UpdateError(f"Delete outside install directory is forbidden: {path}")
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
            raise UpdateError(f"Only regular install files may be removed: {path}")
        path.unlink()


def _configure_logger(paths: InstallPaths) -> logging.Logger:
    _assert_safe_install_tree(paths, create=True)
    logger = logging.getLogger("report_explorer_updater")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    log_path = paths.logs / "updater.log"
    for handler in list(logger.handlers):
        handler_path = getattr(handler, "baseFilename", None)
        if handler_path and not _path_equal(Path(handler_path), log_path):
            logger.removeHandler(handler)
            handler.close()
    if not any(_path_equal(Path(handler.baseFilename), log_path) for handler in logger.handlers if hasattr(handler, "baseFilename")):
        handler = RotatingFileHandler(log_path, maxBytes=1_048_576, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger


class UpdateLock:
    """A per-user named mutex held from discovery through rollback completion."""

    def __init__(self) -> None:
        self._handle: int | None = None
        self._held = False

    def __enter__(self) -> "UpdateLock":
        if os.name != "nt":
            if not _non_windows_lock.acquire(blocking=False):
                raise UpdateInProgress("Another updater is already running")
            self._held = True
            return self
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = (ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p)
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.ReleaseMutex.argtypes = (ctypes.c_void_p,)
        kernel32.ReleaseMutex.restype = ctypes.c_bool
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        kernel32.CloseHandle.restype = ctypes.c_bool
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, True, MUTEX_NAME)
        if not handle:
            raise UpdateError("Unable to create update lock")
        self._handle = int(handle)
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            self._handle = None
            raise UpdateInProgress("Another updater is already running")
        self._held = True
        return self

    def __exit__(self, *_: object) -> None:
        if os.name != "nt":
            if self._held:
                _non_windows_lock.release()
            return
        if self._handle is not None:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.ReleaseMutex(ctypes.c_void_p(self._handle))
            kernel32.CloseHandle(ctypes.c_void_p(self._handle))
        self._handle = None
        self._held = False


def _validated_url(value: str, hosts: frozenset[str]) -> None:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.hostname not in hosts:
        raise UpdateError("Release URL is not an approved HTTPS GitHub endpoint")


def _read_https(url: str, *, timeout: int, max_bytes: int, hosts: frozenset[str]) -> bytes:
    _validated_url(url, hosts)
    request = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "MeasurementJournal-ReportExplorerUpdater"})
    try:
        with urlopen(request, timeout=timeout) as response:
            final_url = response.geturl()
            _validated_url(final_url, API_HOSTS if hosts == API_HOSTS else DOWNLOAD_HOSTS)
            body = response.read(max_bytes + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise UpdateError(f"Release request failed: {type(error).__name__}") from error
    if len(body) > max_bytes:
        raise UpdateError("Release response exceeds the allowed size")
    return body


def _asset_map(release: dict[str, Any], tag: str) -> dict[str, str]:
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise UpdateError("Release asset list is missing")
    result: dict[str, str] = {}
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = asset.get("name")
        url = asset.get("browser_download_url")
        if isinstance(name, str) and isinstance(url, str):
            result[name] = url
    for name in (HELPER_FILENAME, "ReportExplorerSetup.exe", "SHA256SUMS.txt", "release.json"):
        url = result.get(name)
        if not url:
            raise UpdateError(f"Release is missing {name}")
        parsed = urlsplit(url)
        expected = f"/{REPOSITORY}/releases/download/{tag}/{name}"
        if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.path != expected:
            raise UpdateError("Release asset URL does not match the approved repository/tag/name")
    return result


def _parse_sha256s(payload: bytes) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        lines = payload.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise UpdateError("SHA256SUMS is not UTF-8") from error
    for line in lines:
        match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?([^\s]+)", line.strip())
        if match:
            result[match.group(2)] = match.group(1).lower()
    return result


class GitHubReleaseClient:
    """Anonymous HTTPS client restricted to this product's GitHub Release assets."""

    def latest(self, channel: str) -> Release:
        if channel not in ALLOWED_CHANNELS:
            raise UpdateError("Update channel must be stable or pilot")
        raw = _read_https(GITHUB_API_URL, timeout=METADATA_TIMEOUT_SECONDS, max_bytes=1_000_000, hosts=API_HOSTS)
        try:
            releases = json.loads(raw)
        except json.JSONDecodeError as error:
            raise UpdateError("GitHub release response is invalid JSON") from error
        if not isinstance(releases, list):
            raise UpdateError("GitHub release response is not a list")

        selected: tuple[tuple[int, int, int], str, dict[str, Any]] | None = None
        for item in releases:
            if not isinstance(item, dict) or item.get("draft") is True:
                continue
            if channel == "stable" and item.get("prerelease") is True:
                continue
            if channel == "pilot" and item.get("prerelease") is not True:
                continue
            tag = item.get("tag_name")
            if not isinstance(tag, str):
                continue
            prefix = "report-explorer-helper-v" if channel == "stable" else "report-explorer-helper-pilot-v"
            if not tag.startswith(prefix):
                continue
            try:
                version = parse_semver(tag[len(prefix):])
            except UpdateError:
                continue
            if selected is None or version > selected[0]:
                selected = (version, tag, item)
        if selected is None:
            raise UpdateError(f"No approved {channel} release is available")
        _, tag, release = selected
        assets = _asset_map(release, tag)
        manifest_url = assets["release.json"]
        checksum_url = assets["SHA256SUMS.txt"]
        manifest_raw = _read_https(manifest_url, timeout=METADATA_TIMEOUT_SECONDS, max_bytes=64_000, hosts=DOWNLOAD_HOSTS)
        checksums_raw = _read_https(checksum_url, timeout=METADATA_TIMEOUT_SECONDS, max_bytes=64_000, hosts=DOWNLOAD_HOSTS)
        try:
            manifest = json.loads(manifest_raw)
        except json.JSONDecodeError as error:
            raise UpdateError("release.json is invalid") from error
        if not isinstance(manifest, dict):
            raise UpdateError("release.json must be an object")
        release_version = manifest.get("releaseVersion")
        manifest_channel = manifest.get("channel")
        manifest_tag = manifest.get("releaseTag")
        source_commit = manifest.get("sourceCommit")
        helper_version = manifest.get("helperVersion")
        updater_version = manifest.get("updaterVersion")
        setup_version = manifest.get("setupVersion")
        protocol_version = manifest.get("protocolVersion")
        helper_sha256 = manifest.get("helperSha256")
        helper_size = manifest.get("helperSize")
        setup_sha256 = manifest.get("setupSha256")
        setup_size = manifest.get("setupSize")
        if (
            not isinstance(release_version, str)
            or not isinstance(manifest_channel, str)
            or not isinstance(manifest_tag, str)
            or not isinstance(source_commit, str)
            or not isinstance(helper_version, str)
            or not isinstance(updater_version, str)
            or not isinstance(setup_version, str)
            or not isinstance(protocol_version, str)
            or not isinstance(helper_sha256, str)
            or not isinstance(helper_size, int)
            or not isinstance(setup_sha256, str)
            or not isinstance(setup_size, int)
        ):
            raise UpdateError("release.json is missing required bundle metadata")
        tag_version = tag.rsplit("v", 1)[1]
        if (
            release_version != tag_version
            or helper_version != release_version
            or manifest_channel != channel
            or manifest_tag != tag
            or not re.fullmatch(r"[0-9a-f]{40}", source_commit)
            or updater_version != release_version
            or setup_version != release_version
            or protocol_version != PROTOCOL_VERSION
        ):
            raise UpdateError("Release version or protocol is incompatible")
        parse_semver(release_version)
        helper_sha256 = helper_sha256.lower()
        setup_sha256 = setup_sha256.lower()
        if not SHA256_RE.fullmatch(helper_sha256) or not SHA256_RE.fullmatch(setup_sha256):
            raise UpdateError("release.json has an invalid bundle SHA-256")
        if (
            not MIN_HELPER_SIZE_BYTES <= helper_size <= MAX_HELPER_SIZE_BYTES
            or not MIN_HELPER_SIZE_BYTES <= setup_size <= MAX_HELPER_SIZE_BYTES
        ):
            raise UpdateError("release.json has an implausible bundle size")
        checksums = _parse_sha256s(checksums_raw)
        if (
            checksums.get(HELPER_FILENAME) != helper_sha256
            or checksums.get("ReportExplorerSetup.exe") != setup_sha256
        ):
            raise UpdateError("SHA256SUMS does not match release.json")
        return Release(
            channel, helper_version, protocol_version, helper_sha256, helper_size,
            assets[HELPER_FILENAME], release_version, updater_version, setup_version,
            setup_sha256, setup_size, assets["ReportExplorerSetup.exe"],
        )

    def download_helper(self, release: Release, destination: Path) -> None:
        payload = _read_https(
            release.helper_url,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
            max_bytes=MAX_HELPER_SIZE_BYTES,
            hosts=DOWNLOAD_HOSTS,
        )
        if len(payload) != release.helper_size or not payload.startswith(b"MZ"):
            raise UpdateError("Downloaded helper fails size or PE sanity validation")
        digest = hashlib.sha256(payload).hexdigest()
        if digest != release.helper_sha256:
            raise UpdateError("Downloaded helper SHA-256 does not match")
        destination.write_bytes(payload)


class WindowsProcessController:
    """Only terminates PIDs whose image path is rechecked as the exact helper path."""

    def matching_pids(self, executable: Path) -> list[int]:
        if os.name != "nt":
            return []
        kernel32 = ctypes.windll.kernel32
        snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
        if snapshot in (0, -1):
            raise UpdateError("Cannot inspect running processes")

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", ctypes.c_ulong), ("cntUsage", ctypes.c_ulong), ("th32ProcessID", ctypes.c_ulong),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", ctypes.c_ulong), ("cntThreads", ctypes.c_ulong),
                ("th32ParentProcessID", ctypes.c_ulong), ("pcPriClassBase", ctypes.c_long), ("dwFlags", ctypes.c_ulong),
                ("szExeFile", ctypes.c_wchar * 260),
            ]

        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(entry)
        matches: list[int] = []
        try:
            has_entry = bool(kernel32.Process32FirstW(snapshot, ctypes.byref(entry)))
            while has_entry:
                path = self._process_path(int(entry.th32ProcessID))
                if path is not None and _path_equal(path, executable):
                    matches.append(int(entry.th32ProcessID))
                has_entry = bool(kernel32.Process32NextW(snapshot, ctypes.byref(entry)))
        finally:
            kernel32.CloseHandle(snapshot)
        return matches

    def _process_path(self, pid: int) -> Path | None:
        if os.name != "nt":
            return None
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000 | 0x00100000, False, pid)  # QUERY_LIMITED + SYNCHRONIZE
        if not handle:
            return None
        try:
            size = ctypes.c_ulong(32768)
            buffer = ctypes.create_unicode_buffer(size.value)
            if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                return None
            return Path(buffer.value)
        finally:
            kernel32.CloseHandle(handle)

    def stop_exact(self, executable: Path) -> None:
        if os.name != "nt":
            return
        kernel32 = ctypes.windll.kernel32
        for pid in self.matching_pids(executable):
            # PID reuse protection: re-read its full executable path immediately before termination.
            if not _path_equal(self._process_path(pid) or Path("."), executable):
                continue
            handle = kernel32.OpenProcess(0x0001 | 0x00100000, False, pid)  # TERMINATE + SYNCHRONIZE
            if not handle:
                raise UpdateError(f"Cannot stop installed helper PID {pid}")
            try:
                if not kernel32.TerminateProcess(handle, 0):
                    raise UpdateError(f"Failed to stop installed helper PID {pid}")
                if kernel32.WaitForSingleObject(handle, 5_000) != 0:
                    raise UpdateError(f"Installed helper PID {pid} did not exit")
            finally:
                kernel32.CloseHandle(handle)


def start_helper(paths: InstallPaths) -> StartedProcess:
    _assert_safe_install_tree(paths, create=False)
    if not paths.helper.exists() or paths.helper.is_symlink() or not stat.S_ISREG(paths.helper.lstat().st_mode):
        raise UpdateError("Installed helper executable is missing or unsafe")
    creationflags = 0
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    return subprocess.Popen([str(paths.helper)], cwd=str(paths.root), close_fds=True, creationflags=creationflags)


def _health_once() -> dict[str, Any] | None:
    request = Request("http://127.0.0.1:17653/health", headers={"User-Agent": "MeasurementJournal-ReportExplorerUpdater"})
    try:
        with urlopen(request, timeout=1) as response:
            if response.status != 200:
                return None
            payload = json.loads(response.read(32_000))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def helper_is_healthy(expected_version: str | None = None) -> bool:
    payload = _health_once()
    if payload is None:
        return False
    # Storage may be unavailable while RaiDrive restores Z:. That is still a healthy helper.
    if payload.get("status") != "ok" or payload.get("version") != PROTOCOL_VERSION:
        return False
    return expected_version is None or payload.get("helperVersion") == expected_version


def wait_for_health(process: StartedProcess, expected_version: str | None) -> bool:
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        if helper_is_healthy(expected_version):
            return True
        time.sleep(HEALTH_POLL_SECONDS)
    return False


def _load_config(paths: InstallPaths) -> tuple[str, str | None]:
    if not paths.config.exists():
        return "stable", None
    try:
        value = json.loads(paths.config.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "stable", None
    if not isinstance(value, dict):
        return "stable", None
    channel = value.get("channel")
    version = value.get("helperVersion")
    return (channel if channel in ALLOWED_CHANNELS else "stable", version if isinstance(version, str) and SEMVER_RE.fullmatch(version) else None)


def write_config(paths: InstallPaths, channel: str, helper_version: str | None) -> None:
    if channel not in ALLOWED_CHANNELS:
        raise UpdateError("Update channel must be stable or pilot")
    if helper_version is not None:
        parse_semver(helper_version)
    _assert_safe_install_tree(paths, create=True)
    payload: dict[str, str] = {"channel": channel}
    if helper_version is not None:
        payload["helperVersion"] = helper_version
    temporary = paths.config.with_suffix(".json.tmp")
    _safe_unlink(temporary, paths)
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, paths.config)


def register_updater_autostart(paths: InstallPaths) -> None:
    """Write exactly the product's own HKCU Run value; no other registry path is touched."""
    if os.name != "nt":
        return
    _assert_safe_install_tree(paths, create=False)
    if not paths.updater.exists():
        raise UpdateError("Updater executable is missing")
    import winreg

    command = f'"{paths.updater}" --startup'
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, command)


class UpdateEngine:
    def __init__(
        self,
        paths: InstallPaths,
        release_client: ReleaseClient | None = None,
        process_controller: ProcessController | None = None,
        starter: Callable[[InstallPaths], StartedProcess] = start_helper,
        health_waiter: Callable[[StartedProcess, str | None], bool] = wait_for_health,
    ) -> None:
        self.paths = paths
        self.release_client = release_client or GitHubReleaseClient()
        self.process_controller = process_controller or WindowsProcessController()
        self.starter = starter
        self.health_waiter = health_waiter
        self.logger = _configure_logger(paths)

    def _start_current(self, expected_version: str | None) -> UpdateResult:
        if not self.paths.helper.exists():
            raise UpdateError("No installed helper is available for fallback")
        if self.process_controller.matching_pids(self.paths.helper):
            if helper_is_healthy(expected_version):
                return UpdateResult("helper_already_running", expected_version)
            self.process_controller.stop_exact(self.paths.helper)
        process = self.starter(self.paths)
        if not self.health_waiter(process, expected_version):
            raise UpdateError("Installed helper did not pass localhost health")
        return UpdateResult("helper_started", expected_version)

    def _download_verified(self, release: Release) -> None:
        _assert_safe_install_tree(self.paths, create=True)
        _safe_unlink(self.paths.download, self.paths)
        _safe_unlink(self.paths.candidate, self.paths)
        try:
            self.release_client.download_helper(release, self.paths.download)
            if not self.paths.download.exists() or self.paths.download.is_symlink():
                raise UpdateError("Verified helper download is missing")
            data = self.paths.download.read_bytes()
            if len(data) != release.helper_size or hashlib.sha256(data).hexdigest() != release.helper_sha256:
                raise UpdateError("Downloaded helper verification changed before install")
            os.replace(self.paths.download, self.paths.candidate)
        except Exception:
            _safe_unlink(self.paths.download, self.paths)
            _safe_unlink(self.paths.candidate, self.paths)
            raise

    def _replace_and_start(self, release: Release) -> UpdateResult:
        _assert_safe_install_tree(self.paths, create=False)
        _safe_unlink(self.paths.previous, self.paths)
        had_previous = self.paths.helper.exists()
        if had_previous:
            self.process_controller.stop_exact(self.paths.helper)
            os.replace(self.paths.helper, self.paths.previous)
        try:
            os.replace(self.paths.candidate, self.paths.helper)
            process = self.starter(self.paths)
            if not self.health_waiter(process, release.helper_version):
                raise UpdateError("New helper did not pass localhost health")
            write_config(self.paths, release.channel, release.helper_version)
            _safe_unlink(self.paths.previous, self.paths)
            return UpdateResult("updated", release.helper_version)
        except Exception as error:
            self.logger.error("update_failed rollback=true error=%s", type(error).__name__)
            try:
                # A failed candidate can still hold its installed EXE open on Windows.
                # stop_exact rechecks every PID's full image path immediately before stop.
                self.logger.info("rollback_step=stop_failed_helper path=%s", self.paths.helper)
                self.process_controller.stop_exact(self.paths.helper)
                if self.process_controller.matching_pids(self.paths.helper):
                    raise UpdateError("Failed helper process did not exit")
                self.logger.info("rollback_step=remove_failed_helper")
                _safe_unlink(self.paths.helper, self.paths)
                if had_previous:
                    if not self.paths.previous.exists():
                        raise UpdateError("Previous helper is missing")
                    self.logger.info("rollback_step=restore_previous_helper")
                    os.replace(self.paths.previous, self.paths.helper)
                    self.logger.info("rollback_step=start_previous_helper")
                    self._start_current(None)
                    self.logger.info("rollback_complete=true")
            except Exception as rollback_error:
                self.logger.error(
                    "rollback_complete=false status=ROLLBACK_FAILED evidence=%s",
                    rollback_error,
                )
                raise UpdateError(f"ROLLBACK_FAILED: {rollback_error}") from rollback_error
            raise UpdateError("Update failed; prior helper restored") from error
        finally:
            _safe_unlink(self.paths.download, self.paths)
            _safe_unlink(self.paths.candidate, self.paths)

    def run(self, *, acquire_lock: bool = True) -> UpdateResult:
        with (UpdateLock() if acquire_lock else nullcontext()):
            _assert_safe_install_tree(self.paths, create=True)
            channel, current_version = _load_config(self.paths)
            self.logger.info(
                "start updater_version=%s current_helper_version=%s channel=%s",
                UPDATER_VERSION,
                current_version or "unknown",
                channel,
            )
            try:
                release = self.release_client.latest(channel)
                self.logger.info("release latest_helper_version=%s update_channel=%s", release.helper_version, channel)
            except UpdateError as error:
                self.logger.warning("release_lookup_failed fallback=true error=%s", type(error).__name__)
                return self._start_current(None)

            update_required = (
                not self.paths.helper.exists()
                or current_version is None
                or parse_semver(current_version) < parse_semver(release.helper_version)
            )
            if current_version is not None and parse_semver(current_version) > parse_semver(release.helper_version):
                self.logger.info("update_required=false reason=local_version_newer")
                return self._start_current(current_version)
            self.logger.info("update_required=%s", update_required)
            if not update_required:
                return self._start_current(current_version)
            self._download_verified(release)
            return self._replace_and_start(release)


def run_updater() -> int:
    paths = paths_for_current_user()
    try:
        result = UpdateEngine(paths).run()
        _configure_logger(paths).info("final_status=%s rollback=%s", result.status, result.rollback)
        return 0
    except UpdateInProgress:
        _configure_logger(paths).info("final_status=update_in_progress")
        return 0
    except UpdateError as error:
        _configure_logger(paths).error("final_status=failed error=%s", error)
        return 1
