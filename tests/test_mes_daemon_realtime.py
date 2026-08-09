import asyncio
import unittest
from types import SimpleNamespace

from mes_daemon_realtime import (
    DEFAULT_SAFETY_CHECK_SECONDS,
    MesDaemonRuntime,
    MesRealtimeSettings,
    MesWakeCoordinator,
    effective_safety_check_seconds,
    is_pending_mes_event,
)


async def direct_to_thread(function):
    return function()


class FakeChannel:
    def __init__(self):
        self.postgres_callback = None
        self.unsubscribed = False

    def on_postgres_changes(self, *, event, schema, table, filter, callback):
        self.binding = {
            "event": event,
            "schema": schema,
            "table": table,
            "filter": filter,
        }
        self.postgres_callback = callback
        return self

    async def subscribe(self, callback):
        callback(SimpleNamespace(value="SUBSCRIBED"), None)
        return self

    async def unsubscribe(self):
        self.unsubscribed = True


class FakeRealtimeClient:
    def __init__(self):
        self.is_connected = False
        self.channel_instance = FakeChannel()
        self.closed = False
        self._listen_task = None
        self._heartbeat_task = None

    async def connect(self):
        self.is_connected = True

    def channel(self, topic):
        self.topic = topic
        return self.channel_instance

    async def close(self):
        self.is_connected = False
        self.closed = True


class MesDaemonRealtimeTest(unittest.IsolatedAsyncioTestCase):
    def test_event_only_accepts_pending_queue_row(self):
        self.assertTrue(is_pending_mes_event({"new": {"id": 1, "status": "pending"}}))
        self.assertFalse(is_pending_mes_event({"new": {"id": 1, "status": "running"}}))
        self.assertFalse(is_pending_mes_event({"new": {"id": 2, "status": "pending"}}))

    def test_safety_check_cannot_be_shorter_than_six_hours(self):
        self.assertEqual(DEFAULT_SAFETY_CHECK_SECONDS, 21600)
        self.assertEqual(effective_safety_check_seconds(None), 21600)
        self.assertEqual(effective_safety_check_seconds("60"), 21600)

    async def test_duplicate_signals_process_one_claimed_request(self):
        calls = 0
        pending = True
        started = asyncio.Event()
        release = asyncio.Event()

        def check_and_process():
            nonlocal calls, pending
            calls += 1
            if pending:
                pending = False
                return True
            return False

        async def blocked_to_thread(function):
            started.set()
            await release.wait()
            return function()

        coordinator = MesWakeCoordinator(check_and_process, to_thread=blocked_to_thread)
        first = asyncio.create_task(coordinator.wake("realtime-event"))
        await started.wait()
        await coordinator.wake("realtime-event")
        await coordinator.wake("realtime-event")
        release.set()
        await first

        self.assertEqual(coordinator.processed_count, 1)
        self.assertEqual(calls, 2)

    async def test_startup_realtime_and_shutdown_cleanup(self):
        calls = 0
        pending = True

        def check_and_process():
            nonlocal calls, pending
            calls += 1
            if pending:
                pending = False
                return True
            return False

        fake_client = FakeRealtimeClient()
        coordinator = MesWakeCoordinator(check_and_process, to_thread=direct_to_thread)
        runtime = MesDaemonRuntime(
            coordinator,
            MesRealtimeSettings(True, "https://project.supabase.co", "secret", 300),
            realtime_factory=lambda _url, _key: fake_client,
            reconnect_delays=(0.01,),
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(30):
            if fake_client.channel_instance.postgres_callback:
                break
            await asyncio.sleep(0)

        fake_client.channel_instance.postgres_callback(
            {"data": {"record": {"id": 1, "status": "pending"}}}
        )
        await asyncio.sleep(0.01)
        runtime.stop()
        await task

        self.assertGreaterEqual(calls, 2)
        self.assertEqual(coordinator.processed_count, 1)
        self.assertEqual(fake_client.channel_instance.binding["event"], "UPDATE")
        self.assertEqual(fake_client.channel_instance.binding["filter"], "id=eq.1")
        self.assertTrue(fake_client.channel_instance.unsubscribed)
        self.assertTrue(fake_client.closed)

    async def test_six_hour_fallback_path_checks_pending(self):
        calls = 0

        def check_and_process():
            nonlocal calls
            calls += 1
            return False

        runtime = MesDaemonRuntime(
            MesWakeCoordinator(check_and_process, to_thread=direct_to_thread),
            MesRealtimeSettings(False, "", "", 0.01),
        )
        task = asyncio.create_task(runtime.run())
        await asyncio.sleep(0.035)
        runtime.stop()
        await task
        self.assertGreaterEqual(calls, 2)

    async def test_reconnect_checks_missed_pending(self):
        calls = 0
        attempts = 0
        successful_client = FakeRealtimeClient()

        def check_and_process():
            nonlocal calls
            calls += 1
            return False

        class FailingClient(FakeRealtimeClient):
            async def connect(self):
                raise ConnectionError("offline")

        def factory(_url, _key):
            nonlocal attempts
            attempts += 1
            return FailingClient() if attempts == 1 else successful_client

        runtime = MesDaemonRuntime(
            MesWakeCoordinator(check_and_process, to_thread=direct_to_thread),
            MesRealtimeSettings(True, "https://project.supabase.co", "secret", 300),
            realtime_factory=factory,
            reconnect_delays=(0.01,),
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(100):
            if successful_client.channel_instance.postgres_callback:
                break
            await asyncio.sleep(0.01)
        for _ in range(100):
            if calls >= 2:
                break
            await asyncio.sleep(0.01)
        runtime.stop()
        await task

        self.assertGreaterEqual(attempts, 2)
        self.assertGreaterEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
