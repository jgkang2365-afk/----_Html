from __future__ import annotations

import asyncio
import json
from typing import Any, Callable
from urllib.parse import quote


def build_realtime_websocket_url(supabase_url: str, key: str) -> str:
    base = supabase_url.rstrip("/")
    if base.lower().startswith("https://"):
        base = "wss://" + base[8:]
    elif base.lower().startswith("http://"):
        base = "ws://" + base[7:]
    return f"{base}/realtime/v1/websocket?apikey={quote(key, safe='')}&vsn=1.0.0"


class SupabaseBroadcastChannel:
    def __init__(self, client: "SupabaseRealtimeBroadcastClient", topic: str) -> None:
        self.client = client
        self.topic = topic
        self.event = ""
        self.callback: Callable[[dict[str, Any]], None] | None = None
        self.join_ref = ""

    def on_broadcast(
        self, event: str, callback: Callable[[dict[str, Any]], None]
    ) -> "SupabaseBroadcastChannel":
        self.event = event
        self.callback = callback
        return self

    async def subscribe(
        self, callback: Callable[[str, Exception | None], None] | None = None
    ) -> "SupabaseBroadcastChannel":
        try:
            self.join_ref = self.client.next_ref()
            self.client._channel = self
            self.client.join_future = asyncio.get_running_loop().create_future()
            await self.client.send(
                {
                    "topic": f"realtime:{self.topic}",
                    "event": "phx_join",
                    "payload": {
                        "config": {
                            "broadcast": {"ack": False, "self": False},
                            "presence": {"key": "", "enabled": False},
                            "private": False,
                        },
                        "access_token": self.client.key,
                    },
                    "ref": self.join_ref,
                }
            )
            await asyncio.wait_for(self.client.join_future, timeout=20)
            if callback:
                callback("SUBSCRIBED", None)
            return self
        except Exception as error:
            if callback:
                callback("CHANNEL_ERROR", error)
            raise

    async def unsubscribe(self) -> None:
        if not self.client.is_connected:
            return
        await self.client.send(
            {
                "topic": f"realtime:{self.topic}",
                "event": "phx_leave",
                "payload": {},
                "ref": self.client.next_ref(),
            }
        )


class SupabaseRealtimeBroadcastClient:
    def __init__(self, supabase_url: str, key: str, heartbeat_seconds: int = 25) -> None:
        self.supabase_url = supabase_url
        self.key = key
        self.heartbeat_seconds = heartbeat_seconds
        self.websocket: Any = None
        self._channel: SupabaseBroadcastChannel | None = None
        self.join_future: asyncio.Future[Any] | None = None
        self._listen_task: asyncio.Task[Any] | None = None
        self._heartbeat_task: asyncio.Task[Any] | None = None
        self._send_lock = asyncio.Lock()
        self._reference = 0
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def next_ref(self) -> str:
        self._reference += 1
        return str(self._reference)

    async def connect(self) -> None:
        from websockets.asyncio.client import connect  # type: ignore

        self.websocket = await connect(
            build_realtime_websocket_url(self.supabase_url, self.key),
            open_timeout=20,
            ping_interval=None,
        )
        self._connected = True
        self._listen_task = asyncio.create_task(self._listen(), name="supabase-realtime-listen")
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat(), name="supabase-realtime-heartbeat"
        )

    def channel(self, topic: str) -> SupabaseBroadcastChannel:
        return SupabaseBroadcastChannel(self, topic)

    async def send(self, message: dict[str, Any]) -> None:
        if not self.websocket or not self._connected:
            raise ConnectionError("Realtime WebSocket이 연결되지 않았습니다.")
        async with self._send_lock:
            await self.websocket.send(json.dumps(message, ensure_ascii=False))

    async def _listen(self) -> None:
        try:
            async for raw_message in self.websocket:
                message = json.loads(raw_message)
                if (
                    message.get("event") == "phx_reply"
                    and self._channel
                    and message.get("ref") == self._channel.join_ref
                    and self.join_future
                    and not self.join_future.done()
                ):
                    reply = message.get("payload") or {}
                    if reply.get("status") == "ok":
                        self.join_future.set_result(reply.get("response"))
                    else:
                        self.join_future.set_exception(
                            ConnectionError(f"Realtime join 거절: {reply.get('status')}")
                        )
                    continue

                if message.get("event") == "broadcast" and self._channel:
                    payload = message.get("payload") or {}
                    if payload.get("event") == self._channel.event and self._channel.callback:
                        self._channel.callback(payload)
                elif message.get("event") in {"phx_error", "phx_close"}:
                    raise ConnectionError(f"Realtime channel 종료: {message.get('event')}")
        finally:
            self._connected = False

    async def _heartbeat(self) -> None:
        while self._connected:
            await asyncio.sleep(self.heartbeat_seconds)
            await self.send(
                {
                    "topic": "phoenix",
                    "event": "heartbeat",
                    "payload": {},
                    "ref": self.next_ref(),
                }
            )

    async def close(self) -> None:
        self._connected = False
        tasks = [task for task in (self._listen_task, self._heartbeat_task) if task]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._listen_task = None
        self._heartbeat_task = None
        if self.websocket is not None:
            try:
                await self.websocket.close()
            finally:
                self.websocket = None
