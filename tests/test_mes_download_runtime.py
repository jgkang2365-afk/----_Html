import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import mes_download


class MesDownloadRuntimeTest(unittest.TestCase):
    def tearDown(self):
        mes_download.owned_mes_process = None
        mes_download.cancel_requested.clear()

    def test_login_requires_closed_dialog_and_new_main_window(self):
        login = Mock()
        login.exists.return_value = False
        old = Mock(handle=10)
        new = Mock(handle=20)
        with patch("mes_download.Desktop", return_value=Mock(windows=Mock(return_value=[old, new]))):
            main = mes_download.wait_for_logged_in_main(login, {10}, timeout=1)
        self.assertIs(main, new)

    def test_login_that_stays_open_never_returns_a_main_window(self):
        login = Mock()
        login.exists.return_value = True
        with patch("mes_download.Desktop") as desktop, \
             patch("mes_download.time.monotonic", side_effect=[0, 1]):
            with self.assertRaisesRegex(RuntimeError, "MES_MAIN_WINDOW_NOT_FOUND"):
                mes_download.wait_for_logged_in_main(login, set(), timeout=0.5)
        desktop.return_value.windows.assert_not_called()

    def test_start_login_failure_does_not_reach_main_navigation(self):
        process = Mock(pid=1234)
        login = Mock()
        login.exists.return_value = False
        app = Mock()
        app.connect.return_value.window.return_value = login
        with patch("mes_download.Desktop", return_value=Mock(windows=Mock(return_value=[]))), \
             patch("mes_download.subprocess.Popen", return_value=process), \
             patch("mes_download.Application", return_value=app), \
             patch("mes_download.wait_for_logged_in_main", side_effect=RuntimeError("MES_MAIN_WINDOW_NOT_FOUND")), \
             patch("mes_download.send_keys") as keys:
            with self.assertRaisesRegex(RuntimeError, "MES_MAIN_WINDOW_NOT_FOUND"):
                mes_download.start_mes_and_login()
        self.assertNotIn("{VK_MENU}", [call.args[0] for call in keys.call_args_list])

    def test_owned_cleanup_is_pid_tree_scoped_and_idempotent(self):
        process = Mock(pid=1234)
        mes_download.owned_mes_process = process
        with patch("mes_download.os.name", "nt"), patch("mes_download.subprocess.run") as taskkill:
            mes_download.cleanup_owned_mes()
            mes_download.cleanup_owned_mes()
        taskkill.assert_called_once_with(
            ["taskkill", "/f", "/t", "/pid", "1234"],
            stdout=mes_download.subprocess.DEVNULL,
            stderr=mes_download.subprocess.DEVNULL,
            check=False,
        )

    def test_read_only_smoke_cleans_up_after_main_window_verification(self):
        main = Mock(handle=99)
        main.process_id.return_value = 4321
        with patch("mes_download.PASSWORD", "secret"), \
             patch("mes_download.start_mes_and_login", return_value=main), \
             patch("mes_download.cleanup_owned_mes") as cleanup:
            mes_download.read_only_smoke()
        cleanup.assert_called_once()

    def test_save_complete_popup_uses_legacy_dialog_lookup_scoped_to_owned_mes_process(self):
        app = Mock()
        app.connect.return_value = app
        confirm = Mock()
        confirm.exists.return_value = True
        message = Mock()
        message.exists.return_value = True
        confirm.child_window.return_value = message
        app.window.return_value = confirm
        with patch("mes_download.Application", return_value=app) as application:
            found = mes_download.wait_for_save_complete_popup(222, timeout=1)
        self.assertIs(found, confirm)
        application.assert_called_once_with(backend="win32")
        app.connect.assert_called_once_with(process=222, timeout=5)
        app.window.assert_called_once_with(title="확인", class_name="#32770")
        confirm.child_window.assert_called_once_with(title_re=".*자료.*저장.*")

    def test_save_complete_popup_fails_fast_instead_of_silent_five_minute_wait(self):
        app = Mock()
        app.connect.return_value = app
        confirm = Mock()
        confirm.exists.return_value = False
        app.window.return_value = confirm
        with patch("mes_download.Application", return_value=app), \
             patch("mes_download.time.monotonic", side_effect=[0, 1]):
            with self.assertRaisesRegex(RuntimeError, "MES_SAVE_CONFIRMATION_NOT_FOUND"):
                mes_download.wait_for_save_complete_popup(222, timeout=0.5)

    def test_main_window_refresh_reacquires_owned_process_window(self):
        wrong = Mock()
        wrong.process_id.return_value = 111
        matching = Mock()
        matching.process_id.return_value = 222
        with patch("mes_download.Desktop", return_value=Mock(windows=Mock(return_value=[wrong, matching]))):
            found = mes_download.refresh_owned_main_window(222, timeout=1)
        self.assertIs(found, matching)

    def test_mes_save_confirmation_has_no_broken_local_app_or_300_second_loop(self):
        source = Path("mes_download.py").read_text(encoding="utf-8")
        self.assertIn('owned_app.window(title="\ud655\uc778", class_name="#32770")', source)
        self.assertIn('child_window(title_re=".*\uc790\ub8cc.*\uc800\uc7a5.*")', source)
        self.assertNotIn("combined_text", source)
        self.assertNotIn("while time.time() - start_wait < 300", source)
        self.assertIn('MES_SAVE_CONFIRM_TIMEOUT_SECONDS = float(os.getenv("MES_SAVE_CONFIRM_TIMEOUT_SECONDS", "30"))', source)
        self.assertIn("is_interactive =", source)

    def test_mes_execution_has_no_windows_admin_preflight_or_uac_elevation(self):
        source = Path("mes_download.py").read_text(encoding="utf-8")
        for forbidden in ("is_admin", "ensure_admin", "MES_ADMIN_REQUIRED", "ShellExecuteW", '"runas"'):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
