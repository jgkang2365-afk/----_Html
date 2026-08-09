from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


REALTIME_TOPIC = "mes-sync-queue-worker"
REALTIME_SCHEMA = "public"
REALTIME_TABLE = "mes_sync_queue"
REALTIME_FILTER = "id=eq.1"
DEFAULT_SAFETY_CHECK_SECONDS = 6 * 60 * 60
RECONNECT_DELAYS = (5, 10, 30, 60)


def effective_safety_check_seconds(value: str | None) -> int:
    configured = int(value or DEFAULT_SAFETY_CHECK_SECONDS)
    return max(DEFAULT_SAFETY_CHECK_SECONDS, configured)


def env_flag(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def event_record(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("record"), dict):
        return data["record"]
    record = payload.get("new") or payload.get("record") or payload.get("payload")
    return record if isinstance(record, dict) else {}


def is_pending_mes_event(payload: Any) -> bool:
    record = event_record(payload)
    return str(record.get("id")) == "1" and record.get("status") == "pending"


def safe_error_message(error: Exception, secret: str = "") -> str:
    message = str(error)
    if secret:
        message = message.replace(secret, "***")
    return f"{type(error).__name__}: {message}"[:500]


@dataclass(frozen=True)
class MesRealtimeSettings:
    enabled: bool
    supabase_url: str
    realtime_key: str
    safety_check_seconds: int = DEFAULT_SAFETY_CHECK_SECONDS


class MesWakeCoordinator:
    def __init__(
        self,
        check_and_process: Callable[[], bool],
        *,
        to_thread: Callable[..., Awaitable[Any]] = asyncio.to_thread,
    ) -> None:
        self.check_and_process = check_and_process
        self.to_thread = to_thread
        self.lock = asyncio.Lock()
        self.wake_requested = False
        self.processed_count = 0

    async def wake(self, reason: str) -> None:
        if self.lock.locked():
            self.wake_requested = True
            return

        async with self.lock:
            current_reason = reason
            while True:
                self.wake_requested = False
                try:
                    processed = await self.to_thread(self.check_and_process)
                except Exception as error:
                    print(
                        "[MES Daemon] pending 확인 오류:",
                        f"{type(error).__name__}: {str(error)[:500]}",
                    )
                    return
                if processed:
                    self.processed_count += 1
                    print(f"[MES Daemon] 작업 처리 완료 reason={current_reason}")
                if not self.wake_requested:
                    return
                current_reason = "coalesced-event"


class MesDaemonRuntime:
    def __init__(
        self,
        coordinator: MesWakeCoordinator,
        settings: MesRealtimeSettings,
        *,
        realtime_factory: Callable[[str, str], Any] | None = None,
        reconnect_delays: tuple[float, ...] = RECONNECT_DELAYS,
    ) -> None:
        self.coordinator = coordinator
        self.settings = settings
        self.realtime_factory = realtime_factory or self._default_realtime_factory
        self.reconnect_delays = reconnect_delays
        self.stop_event = asyncio.Event()
        self.realtime_client: Any = None
        self.realtime_channel: Any = None
        self.pending_event_task: asyncio.Task[Any] | None = None

    @staticmethod
    def _default_realtime_factory(supabase_url: str, key: str) -> Any:
        from supabase_realtime_postgres_changes import SupabaseRealtimePostgresClient

        return SupabaseRealtimePostgresClient(supabase_url, key)

    async def run(self) -> None:
        print("[MES Daemon] 시작 시 pending 확인을 실행합니다.")
        await self.coordinator.wake("startup")
        tasks = [asyncio.create_task(self._safety_loop(), name="mes-safety-check")]
        if self.settings.enabled:
            tasks.append(asyncio.create_task(self._realtime_loop(), name="mes-realtime"))
        else:
            print("[MES Daemon] Realtime 비활성: 6시간 안전 확인 전용 모드입니다.")

        try:
            await self.stop_event.wait()
        finally:
            self.stop_event.set()
            for task in tasks:
                task.cancel()
            if self.pending_event_task is not None:
                self.pending_event_task.cancel()
                tasks.append(self.pending_event_task)
            await asyncio.gather(*tasks, return_exceptions=True)
            await self._close_realtime()

    def stop(self) -> None:
        self.stop_event.set()

    async def _safety_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self.stop_event.wait(), timeout=self.settings.safety_check_seconds
                )
                return
            except asyncio.TimeoutError:
                print("[MES Daemon] 6시간 안전 확인을 실행합니다.")
                await self.coordinator.wake("safety-check")

    async def _realtime_loop(self) -> None:
        failure_count = 0
        while not self.stop_event.is_set():
            try:
                client = self.realtime_factory(
                    self.settings.supabase_url, self.settings.realtime_key
                )
                self.realtime_client = client
                await client.connect()
                channel = client.channel(REALTIME_TOPIC)
                self.realtime_channel = channel

                def on_event(payload: Any) -> None:
                    if not is_pending_mes_event(payload):
                        return
                    if self.pending_event_task is None or self.pending_event_task.done():
                        self.pending_event_task = asyncio.create_task(
                            self.coordinator.wake("realtime-event"),
                            name="mes-realtime-wake",
                        )
                    else:
                        self.coordinator.wake_requested = True

                subscribed = asyncio.Event()
                failed = asyncio.Event()

                def on_subscribe(status: Any, error: Exception | None) -> None:
                    state = str(getattr(status, "value", status))
                    if state == "SUBSCRIBED":
                        subscribed.set()
                    elif state in {"TIMED_OUT", "CLOSED", "CHANNEL_ERROR"}:
                        if error:
                            print(
                                "[MES Daemon] Realtime 구독 오류:",
                                safe_error_message(error, self.settings.realtime_key),
                            )
                        failed.set()

                channel.on_postgres_changes(
                    event="UPDATE",
                    schema=REALTIME_SCHEMA,
                    table=REALTIME_TABLE,
                    filter=REALTIME_FILTER,
                    callback=on_event,
                )
                await channel.subscribe(on_subscribe)

                subscribe_task = asyncio.create_task(subscribed.wait())
                failed_task = asyncio.create_task(failed.wait())
                stop_task = asyncio.create_task(self.stop_event.wait())
                done, pending = await asyncio.wait(
                    {subscribe_task, failed_task, stop_task},
                    timeout=20,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                if stop_task in done and stop_task.result():
                    return
                if subscribe_task not in done or not subscribe_task.result():
                    raise ConnectionError("Realtime 채널 구독에 실패했습니다.")

                reconnected = failure_count > 0
                failure_count = 0
                print("[MES Daemon] Realtime 구독 완료: mes_sync_queue")
                await self.coordinator.wake(
                    "realtime-reconnected" if reconnected else "realtime-connected"
                )

                while not self.stop_event.is_set():
                    listen_task = getattr(client, "_listen_task", None)
                    heartbeat_task = getattr(client, "_heartbeat_task", None)
                    if (
                        not client.is_connected
                        or any(
                            task is not None and task.done()
                            for task in (listen_task, heartbeat_task)
                        )
                    ):
                        raise ConnectionError("Realtime 연결이 종료되었습니다.")
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failure_count += 1
                delay = self.reconnect_delays[
                    min(failure_count - 1, len(self.reconnect_delays) - 1)
                ]
                print(
                    "[MES Daemon] Realtime 연결 오류:",
                    safe_error_message(error, self.settings.realtime_key),
                )
                await self._close_realtime()
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    continue
            finally:
                await self._close_realtime()

    async def _close_realtime(self) -> None:
        channel, client = self.realtime_channel, self.realtime_client
        self.realtime_channel = None
        self.realtime_client = None
        if channel is not None:
            try:
                await channel.unsubscribe()
            except Exception:
                pass
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass
