from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

LOGGER = logging.getLogger("document-worker")
DOCUMENT_JOB_TYPE = "GENERATE_NEW_BUSINESS_DOCUMENTS"
REALTIME_TOPIC = "document-worker-jobs"
REALTIME_EVENT = "document_generation_pending"
DEFAULT_RECOVERY_POLL_SECONDS = 300
MAX_DRAIN_JOBS = 100
RECONNECT_DELAYS = (5, 10, 30, 60)


def env_flag(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def masked_supabase_url(value: str) -> str:
    if not value:
        return "not-configured"
    try:
        host = value.split("://", 1)[-1].split("/", 1)[0]
        project = host.split(".", 1)[0]
        masked = project[:4] + "***" if project else "***"
        suffix = "." + host.split(".", 1)[1] if "." in host else ""
        return masked + suffix
    except Exception:
        return "configured"


def safe_error_message(error: Exception, secret: str = "") -> str:
    message = str(error)
    if secret:
        message = message.replace(secret, "***")
    return f"{type(error).__name__}: {message}"[:500]


def event_record(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    nested = payload.get("payload")
    return nested if isinstance(nested, dict) else payload


def is_pending_document_event(payload: Any) -> bool:
    record = event_record(payload)
    return (
        str(record.get("status") or "").upper() == "PENDING"
        and str(record.get("job_type") or "") == DOCUMENT_JOB_TYPE
    )


@dataclass(frozen=True)
class RealtimeSettings:
    enabled: bool
    supabase_url: str
    realtime_key: str
    recovery_poll_seconds: int = DEFAULT_RECOVERY_POLL_SECONDS


class ClaimCoordinator:
    def __init__(
        self,
        process_next: Callable[[], str | None],
        *,
        to_thread: Callable[..., Awaitable[Any]] = asyncio.to_thread,
        max_drain_jobs: int = MAX_DRAIN_JOBS,
    ) -> None:
        self.process_next = process_next
        self.to_thread = to_thread
        self.max_drain_jobs = max_drain_jobs
        self.lock = asyncio.Lock()
        self.wake_requested = False

    async def wake(self, reason: str) -> None:
        if self.lock.locked():
            self.wake_requested = True
            LOGGER.info("중복 claim 요청 억제 reason=%s", reason)
            return

        async with self.lock:
            current_reason = reason
            processed = 0
            while processed < self.max_drain_jobs:
                self.wake_requested = False
                try:
                    job_id = await self.to_thread(self.process_next)
                except Exception:
                    LOGGER.exception("claim 처리 오류 reason=%s", current_reason)
                    return

                if job_id is None:
                    if self.wake_requested:
                        current_reason = "coalesced-event"
                        continue
                    LOGGER.info("대기 문서 작업 없음 reason=%s", current_reason)
                    return

                processed += 1
                LOGGER.info("문서 작업 선점 및 처리 완료 id=%s reason=%s", job_id, current_reason)
                current_reason = "queue-drain"

            LOGGER.warning("claim drain 안전 한도 도달 count=%s", self.max_drain_jobs)

    async def handle_realtime_event(self, payload: Any) -> None:
        if not is_pending_document_event(payload):
            return
        LOGGER.info("Realtime 신규 문서 작업 신호 수신")
        await self.wake("realtime-event")


class DocumentWorkerRuntime:
    def __init__(
        self,
        coordinator: ClaimCoordinator,
        settings: RealtimeSettings,
        *,
        realtime_factory: Callable[[str, str], Any] | None = None,
        reconnect_delays: tuple[int, ...] = RECONNECT_DELAYS,
    ) -> None:
        self.coordinator = coordinator
        self.settings = settings
        self.realtime_factory = realtime_factory or self._default_realtime_factory
        self.reconnect_delays = reconnect_delays
        self.stop_event = asyncio.Event()
        self.realtime_client: Any = None
        self.realtime_channel: Any = None

    @staticmethod
    def _default_realtime_factory(supabase_url: str, key: str) -> Any:
        from supabase_realtime_broadcast import SupabaseRealtimeBroadcastClient

        return SupabaseRealtimeBroadcastClient(supabase_url, key)

    async def run(self) -> None:
        await self.coordinator.wake("startup")
        tasks = [asyncio.create_task(self._recovery_loop(), name="document-worker-recovery")]
        if self.settings.enabled:
            tasks.append(asyncio.create_task(self._realtime_loop(), name="document-worker-realtime"))
        else:
            LOGGER.warning("Realtime 비활성: 5분 복구 폴링 전용 모드")
        try:
            await self.stop_event.wait()
        finally:
            self.stop_event.set()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self._close_realtime()

    def stop(self) -> None:
        self.stop_event.set()

    async def _recovery_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self.stop_event.wait(), timeout=self.settings.recovery_poll_seconds
                )
                return
            except asyncio.TimeoutError:
                LOGGER.info("복구 폴링 claim 시작 interval=%ss", self.settings.recovery_poll_seconds)
                await self.coordinator.wake("recovery-poll")

    async def _realtime_loop(self) -> None:
        failure_count = 0
        while not self.stop_event.is_set():
            subscribed = asyncio.Event()
            failed = asyncio.Event()
            try:
                LOGGER.info(
                    "Realtime 연결 시작 url=%s",
                    masked_supabase_url(self.settings.supabase_url),
                )
                client = self.realtime_factory(
                    self.settings.supabase_url, self.settings.realtime_key
                )
                self.realtime_client = client
                await client.connect()
                LOGGER.info("Realtime WebSocket 연결 성공")
                channel = client.channel(REALTIME_TOPIC)
                self.realtime_channel = channel

                def on_event(payload: Any) -> None:
                    asyncio.create_task(self.coordinator.handle_realtime_event(payload))

                def on_subscribe(status: Any, error: Exception | None) -> None:
                    state = str(getattr(status, "value", status))
                    if state == "SUBSCRIBED":
                        subscribed.set()
                    elif state in {"TIMED_OUT", "CLOSED", "CHANNEL_ERROR"}:
                        LOGGER.error(
                            "Realtime 구독 상태 오류 state=%s error=%s",
                            state,
                            safe_error_message(error, self.settings.realtime_key) if error else "",
                        )
                        failed.set()

                channel.on_broadcast(REALTIME_EVENT, on_event)
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

                LOGGER.info(
                    "Realtime 구독 성공 topic=%s event=%s",
                    REALTIME_TOPIC,
                    REALTIME_EVENT,
                )
                if failure_count:
                    LOGGER.info("Realtime 재연결 성공")
                failure_count = 0

                while not self.stop_event.is_set():
                    listen_task = getattr(client, "_listen_task", None)
                    heartbeat_task = getattr(client, "_heartbeat_task", None)
                    background_stopped = any(
                        task is not None and task.done()
                        for task in (listen_task, heartbeat_task)
                    )
                    if not client.is_connected or background_stopped:
                        raise ConnectionError("Realtime 연결이 종료되었습니다.")
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failure_count += 1
                delay = self.reconnect_delays[min(failure_count - 1, len(self.reconnect_delays) - 1)]
                LOGGER.error(
                    "Realtime 연결 오류: %s",
                    safe_error_message(error, self.settings.realtime_key),
                )
                LOGGER.info("Realtime 재연결 시도 delay=%ss", delay)
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
                LOGGER.debug("Realtime channel unsubscribe 실패", exc_info=True)
        if client is not None:
            try:
                await client.close()
            except Exception:
                LOGGER.debug("Realtime client 종료 실패", exc_info=True)
