import asyncio
import unittest
from types import SimpleNamespace

from supabase_realtime_postgres_changes import (
    SupabaseRealtimePostgresClient,
    build_realtime_websocket_url,
)

from document_worker_realtime import (
    DEFAULT_RECOVERY_POLL_SECONDS,
    DOCUMENT_JOB_TYPE,
    ClaimCoordinator,
    DocumentWorkerRuntime,
    RealtimeSettings,
    effective_recovery_poll_seconds,
    env_flag,
    is_pending_document_event,
    safe_error_message,
)


async def direct_to_thread(function):
    return function()


class FakeChannel:
    def __init__(self):
        self.postgres_callback = None
        self.unsubscribed = False

    def on_postgres_changes(self, *, event, schema, table, filter, callback):
        self.binding = {
            "event": event, "schema": schema, "table": table, "filter": filter
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
            binding = parsed["payload"]["config"]["postgres_changes"][0]
            await self.messages.put(
                json.dumps(
                    {
                        "topic": parsed["topic"],
                        "event": "phx_reply",
                        "payload": {
                            "status": "ok",
                            "response": {
                                "postgres_changes": [{**binding, "id": 1}],
                            },
                        },
                        "ref": parsed["ref"],
                    }
                )
            )
            await self.messages.put(
                json.dumps(
                    {
                        "topic": parsed["topic"],
                        "event": "system",
                        "payload": {
                            "extension": "postgres_changes",
                            "status": "ok",
                            "message": "Subscribed to PostgreSQL",
                        },
                        "ref": None,
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

    async def test_direct_postgres_client_joins_and_dispatches_minimal_signal(self):
        import json

        received = []
        websocket = FakeWebSocket()
        client = SupabaseRealtimePostgresClient(
            "https://abcd.supabase.co", "public-key", heartbeat_seconds=3600
        )
        client.websocket = websocket
        client._connected = True
        client._listen_task = asyncio.create_task(client._listen())
        channel = client.channel("document-worker-jobs")
        channel.on_postgres_changes(
            event="INSERT",
            schema="public",
            table="document_job_pending_signals",
            filter="status=eq.PENDING",
            callback=received.append,
        )
        await channel.subscribe()
        await websocket.messages.put(
            json.dumps(
                {
                    "topic": "realtime:document-worker-jobs",
                    "event": "postgres_changes",
                    "payload": {
                        "ids": [],
                        "data": {
                            "type": "INSERT",
                            "record": {
                                "status": "PENDING",
                                "job_type": DOCUMENT_JOB_TYPE,
                            },
                        },
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
        self.assertEqual(received[0]["data"]["record"]["status"], "PENDING")
        binding = websocket.sent[0]["payload"]["config"]["postgres_changes"][0]
        self.assertEqual(binding["event"], "INSERT")
        self.assertEqual(binding["filter"], "status=eq.PENDING")
        self.assertTrue(websocket.sent[0]["payload"]["config"]["broadcast"]["replication_ready"])
        self.assertTrue(websocket.closed)

    async def test_postgres_replication_error_fails_subscription(self):
        import json

        class ReplicationErrorWebSocket(FakeWebSocket):
            async def send(self, message):
                parsed = json.loads(message)
                self.sent.append(parsed)
                if parsed["event"] != "phx_join":
                    return
                binding = parsed["payload"]["config"]["postgres_changes"][0]
                await self.messages.put(
                    json.dumps(
                        {
                            "topic": parsed["topic"],
                            "event": "phx_reply",
                            "payload": {
                                "status": "ok",
                                "response": {"postgres_changes": [{**binding, "id": 1}]},
                            },
                            "ref": parsed["ref"],
                        }
                    )
                )
                await self.messages.put(
                    json.dumps(
                        {
                            "topic": parsed["topic"],
                            "event": "system",
                            "payload": {
                                "extension": "postgres_changes",
                                "status": "error",
                                "message": "replication unavailable",
                            },
                            "ref": None,
                        }
                    )
                )

        client = SupabaseRealtimePostgresClient("https://abcd.supabase.co", "public-key")
        client.websocket = ReplicationErrorWebSocket()
        client._connected = True
        client._listen_task = asyncio.create_task(client._listen())
        channel = client.channel("document-worker-jobs").on_postgres_changes(
            event="INSERT",
            schema="public",
            table="document_job_pending_signals",
            filter="status=eq.PENDING",
            callback=lambda _payload: None,
        )
        with self.assertRaisesRegex(ConnectionError, "replication unavailable"):
            await channel.subscribe()
        await client.close()

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
        self.assertEqual(DEFAULT_RECOVERY_POLL_SECONDS, 21600)
        self.assertEqual(effective_recovery_poll_seconds(None), 21600)
        self.assertEqual(effective_recovery_poll_seconds("300"), 21600)
        self.assertEqual(effective_recovery_poll_seconds("43200"), 43200)
        self.assertTrue(env_flag(None))
        self.assertFalse(env_flag("false"))

    async def test_claim_drains_until_empty(self):
        responses = ["job-1", "job-2", None]
        coordinator = ClaimCoordinator(
            lambda: responses.pop(0), to_thread=direct_to_thread
        )
        await coordinator.wake("startup")
        self.assertEqual(responses, [])

    async def test_realtime_empty_claim_retries_at_two_and_five_seconds(self):
        responses = [None, None, "job-1", None]
        coordinator = ClaimCoordinator(
            lambda: responses.pop(0),
            to_thread=direct_to_thread,
            realtime_empty_retry_delays=(0, 0),
        )
        await coordinator.wake("realtime-event")
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
        await coordinator.handle_realtime_event(
            {"payload": {"status": "PENDING", "job_type": "EMAIL"}}
        )
        self.assertEqual(calls, 0)

    async def test_runtime_startup_claim_processes_pending_job_once_then_drains(self):
        responses = ["job-1", None]
        settings = RealtimeSettings(False, "", "", DEFAULT_RECOVERY_POLL_SECONDS)
        coordinator = ClaimCoordinator(
            lambda: responses.pop(0),
            to_thread=direct_to_thread,
        )
        runtime = DocumentWorkerRuntime(coordinator, settings)
        task = asyncio.create_task(runtime.run())
        for _ in range(20):
            if not responses:
                break
            await asyncio.sleep(0)
        runtime.stop()
        await task
        self.assertEqual(responses, [])

    async def test_realtime_retry_is_preserved_when_startup_claim_is_running(self):
        started = asyncio.Event()
        release = asyncio.Event()
        responses = [None, None, None, None]

        async def blocked_to_thread(function):
            started.set()
            await release.wait()
            return function()

        coordinator = ClaimCoordinator(
            lambda: responses.pop(0),
            to_thread=blocked_to_thread,
            realtime_empty_retry_delays=(0, 0),
        )
        startup = asyncio.create_task(coordinator.wake("startup"))
        await started.wait()
        await coordinator.wake("realtime-event")
        release.set()
        await startup
        self.assertEqual(responses, [])

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
        coordinator = ClaimCoordinator(
            process_next, to_thread=direct_to_thread, realtime_empty_retry_delays=()
        )
        runtime = DocumentWorkerRuntime(
            coordinator,
            settings,
            realtime_factory=lambda _url, _key: fake_client,
            reconnect_delays=(0,),
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(20):
            if fake_client.channel_instance.postgres_callback:
                break
            await asyncio.sleep(0)
        for _ in range(3):
            fake_client.channel_instance.postgres_callback(
                {
                    "data": {
                        "type": "INSERT",
                        "record": {"status": "PENDING", "job_type": DOCUMENT_JOB_TYPE},
                    }
                }
            )
        for _ in range(20):
            if calls >= 3:
                break
            await asyncio.sleep(0.05)
        runtime.stop()
        await task
        self.assertEqual(calls, 3)
        self.assertTrue(fake_client.channel_instance.unsubscribed)
        self.assertTrue(fake_client.closed)

    async def test_connection_loss_resubscribes_and_claims_immediately(self):
        calls = 0
        clients = []

        def process_next():
            nonlocal calls
            calls += 1
            return None

        def factory(_url, _key):
            client = FakeRealtimeClient()
            clients.append(client)
            return client

        settings = RealtimeSettings(
            True,
            "https://project.supabase.co",
            "anon",
            DEFAULT_RECOVERY_POLL_SECONDS,
        )
        coordinator = ClaimCoordinator(
            process_next,
            to_thread=direct_to_thread,
            realtime_empty_retry_delays=(),
        )
        runtime = DocumentWorkerRuntime(
            coordinator,
            settings,
            realtime_factory=factory,
            reconnect_delays=(0,),
            connection_check_seconds=0.01,
        )
        task = asyncio.create_task(runtime.run())
        for _ in range(50):
            if clients and calls >= 2:
                break
            await asyncio.sleep(0.01)
        clients[0].is_connected = False
        for _ in range(100):
            if len(clients) >= 2 and calls >= 3:
                break
            await asyncio.sleep(0.01)
        runtime.stop()
        await task
        self.assertEqual(len(clients), 2)
        self.assertEqual(calls, 3)

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
