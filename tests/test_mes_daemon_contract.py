import io
import threading
import unittest
from unittest.mock import patch

import mes_daemon


class _FinishedProcess:
    def __init__(self, output: str, returncode: int) -> None:
        self.stdout = io.StringIO(output)
        self.stdin = io.StringIO()
        self.returncode = returncode

    def poll(self):
        return self.returncode


class MesDaemonContractTest(unittest.TestCase):
    def _worker(self):
        worker = object.__new__(mes_daemon.MesWorker)
        worker.current_job_id = "job-1"
        worker.current_job_effect_started = False
        worker.cancel_requested = threading.Event()
        worker.cleanup_zombie_processes = lambda: None
        worker.update_calls = []
        worker.update = lambda job_id, **fields: worker.update_calls.append((job_id, fields))
        return worker

    @patch("mes_daemon.subprocess.Popen")
    def test_streamed_effect_event_marks_boundary_before_success(self, popen):
        popen.return_value = _FinishedProcess("before\nAUTOMATION_EVENT:effect_start_request\nafter\n", 0)
        worker = self._worker()
        with patch.object(mes_daemon, "DRY_RUN", False):
            result, effect_started = worker.run_macro()

        self.assertTrue(effect_started)
        self.assertTrue(worker.current_job_effect_started)
        self.assertTrue(result["syncSuccess"])
        self.assertTrue(any(call[1].get("effect_started_at") for call in worker.update_calls))
        self.assertEqual(popen.return_value.stdin.getvalue(), '{"allow": true}\n')

    @patch("mes_daemon.subprocess.Popen")
    def test_effect_event_before_child_failure_is_retained_for_confirm_required(self, popen):
        popen.return_value = _FinishedProcess("AUTOMATION_EVENT:effect_start_request\nupload failed\n", 1)
        worker = self._worker()
        with patch.object(mes_daemon, "DRY_RUN", False):
            with self.assertRaises(RuntimeError):
                worker.run_macro()

        self.assertTrue(worker.current_job_effect_started)

    @patch("mes_daemon.subprocess.Popen")
    def test_failed_durable_marker_denies_upload(self, popen):
        popen.return_value = _FinishedProcess("AUTOMATION_EVENT:effect_start_request\n", 0)
        worker = self._worker()
        def reject_marker(job_id, **fields):
            raise RuntimeError("marker failed")
        worker.update = reject_marker
        with patch.object(mes_daemon, "DRY_RUN", False):
            with self.assertRaises(RuntimeError):
                worker.run_macro()
        self.assertEqual(popen.return_value.stdin.getvalue(), '{"allow": false}\n')
        self.assertFalse(worker.current_job_effect_started)


if __name__ == "__main__":
    unittest.main()
