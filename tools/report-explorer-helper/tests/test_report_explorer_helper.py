"""Behavioral contract tests for the disconnected report explorer helper."""

from __future__ import annotations

import importlib
import json
import sys
import tempfile
import threading
import time
import unicodedata
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


HELPER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPER_DIR))
helper = importlib.import_module("report_explorer_helper")

ReportExplorerError = helper.ReportExplorerError
ReportExplorerService = helper.ReportExplorerService
create_server = helper.create_server


class ReportExplorerServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.period = self.root / "2026년" / "상반기"
        self.period.mkdir(parents=True)
        self.launcher = Mock()
        self.clock = Mock(return_value=100.0)
        self.service = ReportExplorerService(
            self.root, launcher=self.launcher, token_ttl_seconds=300, clock=self.clock
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def make_folder(self, name: str) -> Path:
        folder = self.period / name
        folder.mkdir()
        return folder

    def assert_error(self, code: str, action) -> None:
        with self.assertRaises(ReportExplorerError) as raised:
            action()
        self.assertEqual(raised.exception.code, code)

    def test_health_exposes_only_storage_availability_and_configured_root(self) -> None:
        health = self.service.health()

        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["version"], "1")
        self.assertEqual(health["storage"], {
            "available": True,
            "root": str(self.root.resolve()),
        })

    def test_exact_substring_multiple_and_not_found(self) -> None:
        self.make_folder("한결환경")
        self.make_folder("한결기술")
        self.make_folder("미래안전")

        response = self.service.search(2026, "상반기", ["한결환경", "한결", "없는사업장"])
        exact, substring, missing = response["results"]

        self.assertEqual(exact["status"], "FOUND")
        self.assertEqual([match["folderName"] for match in exact["matches"]], ["한결환경"])
        self.assertEqual(substring["status"], "MULTIPLE")
        self.assertEqual({match["folderName"] for match in substring["matches"]}, {"한결환경", "한결기술"})
        self.assertEqual(missing, {"query": "없는사업장", "status": "NOT_FOUND", "matches": []})

    def test_corporate_markers_and_unicode_nfc_match_business_names(self) -> None:
        self.make_folder("(주)한결환경")
        self.make_folder("㈜미래기술")
        decomposed = unicodedata.normalize("NFD", "가나다환경")
        self.make_folder(decomposed)

        response = self.service.search(2026, "상반기", ["한결환경", "미래기술", "가나다환경"])

        self.assertEqual([row["status"] for row in response["results"]], ["FOUND", "FOUND", "FOUND"])
        self.assertEqual(response["results"][0]["matches"][0]["folderName"], "(주)한결환경")
        self.assertEqual(response["results"][1]["matches"][0]["folderName"], "㈜미래기술")
        self.assertEqual(response["results"][2]["matches"][0]["folderName"], decomposed)

    def test_multiple_names_enumerate_the_period_directory_once(self) -> None:
        self.make_folder("한결환경")
        self.make_folder("미래안전")

        response = self.service.search(2026, "상반기", ["한결환경", "미래안전", "없는사업장"])

        self.assertEqual(response["directoryReadCount"], 1)
        self.assertEqual([item["status"] for item in response["results"]], ["FOUND", "FOUND", "NOT_FOUND"])

    def test_unavailable_storage_root_and_missing_year_period_have_distinct_errors(self) -> None:
        unavailable = ReportExplorerService(Path("Z:/report-explorer-does-not-exist"))
        self.assert_error("STORAGE_ROOT_UNAVAILABLE", lambda: unavailable.search(2026, "상반기", ["한결"]))
        self.assert_error("YEAR_NOT_FOUND", lambda: self.service.search(2025, "상반기", ["한결"]))
        (self.root / "2026년" / "상반기").rmdir()
        self.assert_error("PERIOD_NOT_FOUND", lambda: self.service.search(2026, "상반기", ["한결"]))

    def test_period_read_permission_is_not_reported_as_missing_storage(self) -> None:
        with patch.object(helper.os, "scandir", side_effect=PermissionError("denied")):
            self.assert_error(
                "STORAGE_PERMISSION_DENIED",
                lambda: self.service.search(2026, "상반기", ["한결"]),
            )

    def test_invalid_requests_cover_all_year_and_period_forms(self) -> None:
        invalid_years = [None, True, 0, -1, 2026.0, "2026"]
        invalid_periods = [None, "", "상", "상반기 ", "하반기\n", 1]

        for year in invalid_years:
            with self.subTest(year=year):
                self.assert_error("INVALID_REQUEST", lambda year=year: self.service.search(year, "상반기", ["한결"]))
        for period in invalid_periods:
            with self.subTest(period=period):
                self.assert_error("INVALID_REQUEST", lambda period=period: self.service.search(2026, period, ["한결"]))
        for names in ([], [""], [" "], ["한결", "../escape"], "한결"):
            with self.subTest(names=names):
                self.assert_error("INVALID_REQUEST", lambda names=names: self.service.search(2026, "상반기", names))

    def test_result_id_is_opaque_expires_and_launches_only_verified_folder(self) -> None:
        folder = self.make_folder("한결환경")
        found = self.service.search(2026, "상반기", ["한결환경"])["results"][0]["matches"][0]

        self.assertNotEqual(found["resultId"], str(folder))
        self.assertNotIn(str(folder), found["resultId"])
        self.assertEqual(self.service.open_result(found["resultId"]), {"ok": True})
        self.launcher.assert_called_once_with(str(folder.resolve()))
        self.assert_error("RESULT_NOT_FOUND", lambda: self.service.open_result("../not-a-result"))
        self.clock.return_value = 401.0
        self.assert_error("RESULT_NOT_FOUND", lambda: self.service.open_result(found["resultId"]))

    def test_symlink_and_root_escape_never_become_openable_results(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        escaped = self.period / "한결-escaped"
        try:
            escaped.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlink unavailable on this Windows host: {error}")

        response = self.service.search(2026, "상반기", ["escaped"])
        self.assertEqual(response["results"][0]["matches"], [])
        self.assert_error("INVALID_REQUEST", lambda: self.service.search(2026, "상반기", ["..\\outside"]))


class ReportExplorerHttpTests(unittest.TestCase):
    allowed_origins = [
        "https://html-tan-six.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        (root / "2026년" / "상반기" / "한결환경").mkdir(parents=True)
        self.service = ReportExplorerService(root, launcher=Mock())
        self.server = create_server(host="127.0.0.1", port=0, service=self.service)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.tempdir.cleanup()

    def request(self, method: str, path: str, *, origin: str | None, body=None):
        headers = {}
        if origin is not None:
            headers["Origin"] = origin
        data = None if body is None else json.dumps(body).encode("utf-8")
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, dict(response.headers.items()), json.loads(response.read() or b"{}")
        except HTTPError as error:
            return error.code, dict(error.headers.items()), json.loads(error.read() or b"{}")

    def test_health_allows_no_origin_but_validates_present_origin(self) -> None:
        status, _, body = self.request("GET", "/health", origin=None)
        self.assertEqual((status, body["status"], body["version"]), (200, "ok", "1"))
        self.assertIsInstance(body["storage"]["available"], bool)
        self.assertIsInstance(body["storage"]["root"], str)
        status, _, body = self.request("GET", "/health", origin="https://evil.example")
        self.assertEqual((status, body["error"]["code"]), (403, "FORBIDDEN_ORIGIN"))

    def test_cors_allows_exact_production_and_development_origins_only(self) -> None:
        for origin in self.allowed_origins:
            with self.subTest(origin=origin):
                status, headers, _ = self.request("OPTIONS", "/report-explorer/search", origin=origin)
                self.assertEqual(status, 204)
                self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin)
                status, headers, body = self.request(
                    "POST", "/report-explorer/search", origin=origin,
                    body={"year": 2026, "period": "상반기", "businessNames": ["한결환경"]},
                )
                self.assertEqual((status, body["results"][0]["status"]), (200, "FOUND"))
                self.assertEqual(headers.get("Access-Control-Allow-Origin"), origin)

        for origin in ("https://evil.example", "https://html-tan-six.vercel.app.evil.example", "null", None):
            with self.subTest(origin=origin):
                status, _, body = self.request("POST", "/report-explorer/search", origin=origin,
                    body={"year": 2026, "period": "상반기", "businessNames": ["한결환경"]})
                self.assertEqual((status, body["error"]["code"]), (403, "FORBIDDEN_ORIGIN"))

    def test_private_network_preflight_and_loopback_bind_are_strict(self) -> None:
        request = Request(
            f"{self.base_url}/report-explorer/search",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
            method="OPTIONS",
        )
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")

        with self.assertRaises(ValueError):
            create_server(host="0.0.0.0", port=0, service=self.service)

    def test_http_rejects_invalid_and_expired_result_ids_and_malformed_payloads(self) -> None:
        origin = "http://localhost:3000"
        status, _, body = self.request("POST", "/report-explorer/open", origin=origin, body={"resultId": "missing"})
        self.assertEqual((status, body["error"]["code"]), (404, "RESULT_NOT_FOUND"))
        status, _, body = self.request("POST", "/report-explorer/open", origin=origin, body={"path": "C:/"})
        self.assertEqual((status, body["error"]["code"]), (400, "INVALID_REQUEST"))
        status, _, body = self.request("POST", "/report-explorer/search", origin=origin,
            body={"year": "2026", "period": "상반기", "businessNames": []})
        self.assertEqual((status, body["error"]["code"]), (400, "INVALID_REQUEST"))


if __name__ == "__main__":
    unittest.main()
