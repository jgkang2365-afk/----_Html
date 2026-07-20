import asyncio
import unittest
from types import SimpleNamespace

from supabase_realtime_broadcast import (
    SupabaseRealtimeBroadcastClient,
    build_realtime_websocket_url,
)

from document_worker_realtime import (
    DEFAULT_RECOVERY_POLL_SECONDS,
    DOCUMENT_JOB_TYPE,
    ClaimCoordinator,
    DocumentWorkerRuntime,
    RealtimeSettings,
    env_flag,
    is_pending_document_event,
    safe_error_message,
)


async def direct_to_thread(function):
    return function()


class FakeChannel:
    def __init__(self):
        self.broadcast_callback = None
        self.unsubscribed = False

    def on_broadcast(self, event, callback):
        self.event = event
        self.broadcast_callback = callback
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


class FakeWebSocket:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.sent = []
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.messages.get()
        if message is None:
            raise StopAsyncIteration
        return message

    async def send(self, message):
        import json

        parsed = json.loads(message)
        self.sent.append(parsed)
        if parsed["event"] == "phx_join":
            await self.messages.put(
                json.dumps(
                    {
                        "topic": parsed["topic"],
                        "event": "phx_reply",
                        "payload": {"status": "ok", "response": {}},
                        "ref": parsed["ref"],
                    }
                )
            )

    async def close(self):
        self.closed = True
        await self.messages.put(None)


class DocumentWorkerRealtimeTest(unittest.IsolatedAsyncioTestCase):
    def test_websocket_url_uses_realtime_endpoint_without_logging_helper(self):
        url = build_realtime_websocket_url("https://abcd.supabase.co", "public-key")
        self.assertEqual(
            url,
            "wss://abcd.supabase.co/realtime/v1/websocket?apikey=public-key&vsn=1.0.0",
        )

    async def test_direct_broadcast_client_joins_and_dispatches_minimal_signal(self):
        import json

        received = []
        websocket = FakeWebSocket()
        client = SupabaseRealtimeBroadcastClient(
            "https://abcd.supabase.co", "public-key", heartbeat_seconds=3600
        )
        client.websocket = websocket
        client._connected = True
        client._listen_task = asyncio.create_task(client._listen())
        channel = client.channel("document-worker-jobs")
        channel.on_broadcast("document_generation_pending", received.append)
        await channel.subscribe()
        await websocket.messages.put(
            json.dumps(
                {
                    "topic": "realtime:document-worker-jobs",
                    "event": "broadcast",
                    "payload": {
                        "event": "document_generation_pending",
                        "payload": {
                            "status": "PENDING",
                            "job_type": DOCUMENT_JOB_TYPE,
                        },
                        "type": "broadcast",
                    },
                    "ref": None,
                }
            )
        )
        for _ in range(20):
            if received:
                break
            await asyncio.sleep(0)
        await client.close()
        self.assertEqual(received[0]["payload"]["status"], "PENDING")
        self.assertTrue(websocket.closed)
    def test_event_filter_only_accepts_pending_document_jobs(self):
        valid = {
            "payload": {"status": "PENDING", "job_type": DOCUMENT_JOB_TYPE}
        }
        self.assertTrue(is_pending_document_event(valid))
        self.assertFalse(
            is_pending_document_event(
                {"payload": {"status": "PROCESSING", "job_type": DOCUMENT_JOB_TYPE}}
            )
        )
        self.assertFalse(
            is_pending_document_event(
                {"payload": {"status": "PENDING", "job_type": "EMAIL"}}
            )
        )

    def test_sensitive_realtime_key_is_redacted_from_errors(self):
        secret = "secret-realtime-key"
        message = safe_error_message(ConnectionError(f"failed url apikey={secret}"), secret)
        self.assertNotIn(secret, message)
        self.assertIn("***", message)

    def test_defaults_and_boolean_fallback(self):
        self.assertEqual(DEFAULT_RECOVERY_POLL_SECONDS, 300)
        self.assertTrue(env_flag(None))
        self.assertFalse(env_flag("false"))

    async def test_claim_drains_until_empty(self):
        responses = ["job-1", "job-2", None]
        coordinator = ClaimCoordinator(
            lambda: responses.pop(0), to_thread=direct_to_thread
        )
        await coordinator.wake("startup")
        self.assertEqual(responses, [])

    async def test_non_target_event_does_not_claim(self):
        calls = 0

        def process_next():
            nonlocal calls
            calls += 1
            return None

        coordinator = ClaimCoordinator(process_next, to_thread=direct_to_thread)
        await coordinator.handle_realtime_event(
            {"payload": {"status": "FAILED", "job_type": DOCUMENT_JOB_TYPE}}
        )
        self.assertEqual(calls, 0)

    async def test_concurrent_events_are_single_flight(self):
        started = asyncio.Event()
        release = asyncio.Event()
        active = 0
        max_active = 0
        responses = ["job-1", None, None]

        def process_next():
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            result = responses.pop(0)
            active -= 1
            return result

        async def blocked_to_thread(function):
            started.set()
            await release.wait()
            return function()

        coordinator = ClaimCoordinator(process_next, to_thread=blocked_to_thread)
        first = asyncio.create_task(coordinator.wake("event-1"))
        await started.wait()
        await coordinator.wake("event-2")
        release.set()
        await first
        self.assertEqual(max_active, 1)
        self.assertLessEqual(len(responses), 1)

    async def test_runtime_claims_on_start_and_realtime_event_then_closes(self):
        calls = 0

        def process_next():
            nonlocal calls
            calls += 1
            return None

        fake_client = FakeRealtimeClient()
        settings = RealtimeSettings(True, "https://project.supabase.co", "anon", 300)
        coordinator = ClaimCoordinator(process_next, to_thread=direct_to_thread)
        runtime = DocumentWorkerRuntime(
            coordinator,
            settings,
            realtime_factory=lambda _url, _key: fake_client,
            reconnect_delays=(0,),
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(20):
            if fake_client.channel_instance.broadcast_callback:
                break
            await asyncio.sleep(0)
        fake_client.channel_instance.broadcast_callback(
            {"payload": {"status": "PENDING", "job_type": DOCUMENT_JOB_TYPE}}
        )
        for _ in range(20):
            if calls >= 2:
                break
            await asyncio.sleep(0)
        runtime.stop()
        await task
        self.assertGreaterEqual(calls, 2)
        self.assertTrue(fake_client.channel_instance.unsubscribed)
        self.assertTrue(fake_client.closed)

    async def test_realtime_disabled_keeps_startup_and_recovery_polling(self):
        calls = 0
        factory_calls = 0

        def process_next():
            nonlocal calls
            calls += 1
            return None

        def factory(_url, _key):
            nonlocal factory_calls
            factory_calls += 1
            return FakeRealtimeClient()

        settings = RealtimeSettings(False, "", "", 0.01)
        coordinator = ClaimCoordinator(process_next, to_thread=direct_to_thread)
        runtime = DocumentWorkerRuntime(
            coordinator, settings, realtime_factory=factory, reconnect_delays=(0.01,)
        )
        task = asyncio.create_task(runtime.run())
        await asyncio.sleep(0.035)
        runtime.stop()
        await task
        self.assertGreaterEqual(calls, 2)
        self.assertEqual(factory_calls, 0)

    async def test_realtime_failure_does_not_stop_recovery_polling(self):
        calls = 0
        connection_attempts = 0

        def process_next():
            nonlocal calls
            calls += 1
            return None

        class FailingClient(FakeRealtimeClient):
            async def connect(self):
                nonlocal connection_attempts
                connection_attempts += 1
                raise ConnectionError("offline")

        settings = RealtimeSettings(True, "https://project.supabase.co", "anon", 0.01)
        coordinator = ClaimCoordinator(process_next, to_thread=direct_to_thread)
        runtime = DocumentWorkerRuntime(
            coordinator,
            settings,
            realtime_factory=lambda _url, _key: FailingClient(),
            reconnect_delays=(0.01,),
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(50):
            if connection_attempts >= 2 and calls >= 2:
                break
            await asyncio.sleep(0.01)
        runtime.stop()
        await task
        self.assertGreaterEqual(connection_attempts, 2)
        self.assertGreaterEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
