import io
import asyncio
from datetime import datetime, timedelta, timezone
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


class _FailingStdin:
    def write(self, _value):
        raise BrokenPipeError("child stdin closed")

    def flush(self):
        raise BrokenPipeError("child stdin closed")


class _FlushFailingStdin:
    def write(self, value):
        return len(value)

    def flush(self):
        raise BrokenPipeError("child stdin flush failed")


class _MarkerApprovedButReplyLostProcess(_FinishedProcess):
    def __init__(self):
        super().__init__("AUTOMATION_EVENT:effect_start_request\n", 0)
        self.stdin = _FailingStdin()


class _MarkerApprovedButFlushLostProcess(_FinishedProcess):
    def __init__(self):
        super().__init__("AUTOMATION_EVENT:effect_start_request\n", 0)
        self.stdin = _FlushFailingStdin()


class MesDaemonContractTest(unittest.TestCase):
    def _worker(self):
        worker = object.__new__(mes_daemon.MesWorker)
        worker.current_job_id = "job-1"
        worker.current_job_effect_started = False
        worker.cancel_requested = threading.Event()
        worker.cleanup_zombie_processes = lambda: None
        worker.update_calls = []
        worker.update = lambda job_id, **fields: worker.update_calls.append((job_id, fields))
        worker.allow_effect_start = lambda job_id: True
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
        self.assertTrue(worker.current_job_effect_started)
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
        worker.allow_effect_start = lambda job_id: False
        with patch.object(mes_daemon, "DRY_RUN", False):
            with self.assertRaises(RuntimeError):
                worker.run_macro()
        self.assertEqual(popen.return_value.stdin.getvalue(), '{"allow": false}\n')
        self.assertFalse(worker.current_job_effect_started)

    @patch("mes_daemon.subprocess.Popen")
    def test_marker_success_but_child_allow_reply_failure_is_confirm_required(self, popen):
        popen.return_value = _MarkerApprovedButReplyLostProcess()
        worker = self._worker()
        worker.claim = lambda: {"id": "job-1", "status": "RUNNING"}
        worker.allow_effect_start = lambda job_id: True
        with patch.object(mes_daemon, "DRY_RUN", False):
            self.assertTrue(worker.process_next())
        terminals = [fields for _, fields in worker.update_calls if fields.get("status")]
        self.assertEqual(terminals[-1]["status"], "CONFIRM_REQUIRED")
        self.assertEqual(terminals[-1]["result_code"], "MES_EFFECT_UNCERTAIN")

    @patch("mes_daemon.subprocess.Popen")
    def test_marker_success_but_child_allow_flush_failure_is_confirm_required(self, popen):
        popen.return_value = _MarkerApprovedButFlushLostProcess()
        worker = self._worker()
        worker.claim = lambda: {"id": "job-1", "status": "RUNNING"}
        worker.allow_effect_start = lambda job_id: True
        with patch.object(mes_daemon, "DRY_RUN", False):
            self.assertTrue(worker.process_next())
        terminals = [fields for _, fields in worker.update_calls if fields.get("status")]
        self.assertEqual(terminals[-1]["status"], "CONFIRM_REQUIRED")
        self.assertEqual(terminals[-1]["result_code"], "MES_EFFECT_UNCERTAIN")

    @patch("mes_daemon.subprocess.Popen")
    def test_cancelled_database_owner_denies_effect_even_without_local_cancel_signal(self, popen):
        popen.return_value = _FinishedProcess("AUTOMATION_EVENT:effect_start_request\n", 0)
        worker = self._worker()
        worker.allow_effect_start = lambda job_id: False
        with patch.object(mes_daemon, "DRY_RUN", False):
            with self.assertRaisesRegex(RuntimeError, "MES_EFFECT_PERMISSION_DENIED"):
                worker.run_macro()
        self.assertEqual(popen.return_value.stdin.getvalue(), '{"allow": false}\n')

    def test_pre_effect_user_cancel_finishes_cancelled_not_failed(self):
        worker = self._worker()
        worker.claim = lambda: {"id": "job-1", "status": "RUNNING"}
        worker.run_macro = lambda: (_ for _ in ()).throw(RuntimeError("MES_EFFECT_PERMISSION_DENIED"))
        self.assertTrue(worker.process_next())
        terminals = [fields for _, fields in worker.update_calls if fields.get("status")]
        self.assertEqual(len(terminals), 1)
        self.assertEqual(terminals[0]["status"], "CANCELLED")
        self.assertEqual(terminals[0]["result_code"], "USER_CANCELLED")

    def test_completed_parent_drains_child_and_arms_durable_retry(self):
        worker = self._worker()
        worker.claim = lambda: {"id": "job-1", "status": "RUNNING"}
        worker.run_macro = lambda: ({"syncSuccess": True}, True)
        drains = []
        worker.drain_post_sync = lambda: drains.append(1)
        self.assertTrue(worker.process_next())
        self.assertEqual(drains, [1])
        self.assertEqual([fields["status"] for _, fields in worker.update_calls if "status" in fields], ["COMPLETED"])

    def test_post_sync_failure_retries_without_idle_polling(self):
        worker = self._worker()
        worker.post_sync_lock = threading.RLock()
        worker.post_sync_timer = None
        worker.post_sync_deadline = None
        calls = []
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()

        class Response:
            data = [{"available_at": future}]

        class Query:
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def order(self, *_args): return self
            def limit(self, *_args): return self
            def execute(self): return Response()

        class Supabase:
            def rpc(self, name, args):
                calls.append((name, args))
                return self
            def execute(self): return Response()
            def table(self, name):
                calls.append(("table", name))
                return Query()

        timers = []
        class Timer:
            daemon = False
            def __init__(self, delay, callback):
                self.delay = delay
                self.callback = callback
                timers.append(self)
            def start(self): pass
            def cancel(self): pass

        worker.supabase = Supabase()
        with patch.object(mes_daemon.threading, "Timer", Timer):
            worker.drain_post_sync()
        self.assertEqual(calls[0], ("process_mes_post_sync_checks", {"p_limit": 100}))
        self.assertEqual(len(timers), 1)
        self.assertGreater(timers[0].delay, 4 * 60)


if __name__ == "__main__":
    unittest.main()


class MesRealtimeReconnectTest(unittest.IsolatedAsyncioTestCase):
    async def test_close_breaks_idle_wait_and_reconciles_once_on_reconnect(self):
        reconciles = []
        connections = []

        class Worker:
            def reconcile_stale_jobs(self):
                reconciles.append(1)

            def process_next(self):
                return False

            def on_signal(self, record):
                pass

        class Channel:
            def on_postgres_changes(self, **kwargs):
                pass

            async def subscribe(self):
                pass

            async def unsubscribe(self):
                pass

        class Client:
            def __init__(self, *_args):
                self.ordinal = len(connections)
                connections.append(self)
                self.is_connected = True
                self._listen_task = None
                self._heartbeat_task = None

            async def connect(self):
                async def listen():
                    if self.ordinal == 0:
                        await asyncio.sleep(0.01)
                        self.is_connected = False
                    else:
                        await asyncio.Event().wait()
                self._listen_task = asyncio.create_task(listen())

            def channel(self, _topic):
                return Channel()

            async def close(self):
                self.is_connected = False
                self._listen_task.cancel()
                await asyncio.gather(self._listen_task, return_exceptions=True)

        with patch.object(mes_daemon, "MesWorker", Worker), \
             patch.object(mes_daemon, "SupabaseRealtimePostgresClient", Client), \
             patch.object(mes_daemon, "RECOVERY_DELAYS", (0,)), \
             patch.dict(mes_daemon.os.environ, {"SUPABASE_URL": "https://example.test", "SUPABASE_REALTIME_KEY": "key"}):
            task = asyncio.create_task(mes_daemon.run_worker())
            try:
                await asyncio.wait_for(self._wait_for(lambda: len(reconciles) >= 2), 1)
                self.assertEqual(len(reconciles), 2)
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def _wait_for(self, predicate):
        while not predicate():
            await asyncio.sleep(0.005)
