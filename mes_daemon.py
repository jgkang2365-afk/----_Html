"""Realtime MES worker for the common automation_jobs contract.

The daemon does one reconcile at start/reconnect and otherwise wakes only on
automation_job_signals. It never resets a terminal job back to idle.
"""
from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import threading
import queue
import time
import traceback
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client

from supabase_realtime_postgres_changes import SupabaseRealtimePostgresClient

ROOT_DIR = Path(__file__).resolve().parent
MES_JOB_TYPE = "MES_SYNC"
RECOVERY_DELAYS = (5, 10, 30, 60)
MACRO_TIMEOUT_SECONDS = int(os.getenv("MES_DAEMON_MACRO_TIMEOUT_SECONDS", "600"))
LEASE_HEARTBEAT_SECONDS = int(os.getenv("MES_DAEMON_LEASE_HEARTBEAT_SECONDS", "20"))
DRY_RUN = os.getenv("MES_DAEMON_DRY_RUN", "").lower() in {"1", "true", "yes"}


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_supabase():
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("Supabase 환경 변수가 없습니다.")
    return create_client(url, key)


class MesWorker:
    def __init__(self) -> None:
        load_env_file(ROOT_DIR / ".env.local")
        load_env_file(ROOT_DIR / ".env")
        self.supabase = get_supabase()
        self.worker_id = os.getenv("MES_WORKER_ID") or f"{socket.gethostname()}-mes-{os.getpid()}"
        self.current_job_id: str | None = None
        self.current_job_effect_started = False
        self.cancel_requested = threading.Event()
        self.post_sync_timer: threading.Timer | None = None
        self.post_sync_deadline: float | None = None
        self.post_sync_lock = threading.RLock()

    def claim(self) -> dict[str, Any] | None:
        response = self.supabase.rpc(
            "claim_next_automation_job",
            {"p_worker_id": self.worker_id, "p_job_types": [MES_JOB_TYPE]},
        ).execute()
        rows = response.data or []
        return rows[0] if rows else None

    def reconcile_stale_jobs(self) -> None:
        # A reconnect performs one safe reconciliation. Expired RUNNING jobs
        # are marked CONFIRM_REQUIRED by the RPC; they are never blindly run.
        self.supabase.rpc(
            "reconcile_stale_automation_jobs", {"p_job_types": [MES_JOB_TYPE]}
        ).execute()

    def update(self, job_id: str, **fields: Any) -> None:
        # Every worker-originated state write is ownership-checked in the
        # database.  A stale daemon must not overwrite a job reclaimed after
        # pre-effect recovery merely because it still knows the UUID.
        self.supabase.rpc(
            "update_automation_job_owned",
            {"p_job_id": job_id, "p_worker_id": self.worker_id, "p_fields": fields},
        ).execute()
        self.drain_post_sync()

    def drain_post_sync(self) -> None:
        # A completed parent already created its durable child in Postgres.
        # This service-role RPC performs one DB-only drain and arms the next
        # persisted available_at retry; an idle daemon never polls the DB.
        with self.post_sync_lock:
            try:
                self.supabase.rpc("process_mes_post_sync_checks", {"p_limit": 100}).execute()
                response = (self.supabase.table("automation_jobs")
                    .select("available_at").eq("job_type", "MES_POST_SYNC_CHECK")
                    .eq("status", "PENDING").order("available_at").limit(1).execute())
                row = (response.data or [None])[0]
                if not row:
                    if self.post_sync_timer:
                        self.post_sync_timer.cancel()
                    self.post_sync_timer = None
                    self.post_sync_deadline = None
                    return
                available = datetime.fromisoformat(row["available_at"].replace("Z", "+00:00"))
                deadline = available.timestamp()
            except Exception as error:
                print(f"[MES Worker] DB 후속 점검 재시도 예약: {error}")
                deadline = time.time() + 30
            if self.post_sync_deadline is not None and self.post_sync_deadline <= deadline:
                return
            if self.post_sync_timer:
                self.post_sync_timer.cancel()
            self.post_sync_deadline = deadline
            def retry() -> None:
                with self.post_sync_lock:
                    self.post_sync_timer = None
                    self.post_sync_deadline = None
                self.drain_post_sync()
            self.post_sync_timer = threading.Timer(max(0.1, deadline - time.time()), retry)
            self.post_sync_timer.daemon = True
            self.post_sync_timer.start()

    def allow_effect_start(self, job_id: str) -> bool:
        response = self.supabase.rpc(
            "mark_mes_automation_effect_started",
            {"p_job_id": job_id, "p_worker_id": self.worker_id},
        ).execute()
        return response.data is True

    def on_signal(self, record: dict[str, Any]) -> None:
        if record.get("job_type") != MES_JOB_TYPE:
            return
        if record.get("job_id") == self.current_job_id and record.get("status") == "CANCEL_REQUESTED":
            self.cancel_requested.set()

    def cleanup_zombie_processes(self) -> None:
        # Existing MES cleanup remains local to the interactive worker process.
        for image_name in ("excel.exe", "hwsmes.exe"):
            subprocess.run(["taskkill", "/f", "/im", image_name], capture_output=True, text=True, check=False)

    def run_macro(self) -> tuple[dict[str, Any], bool]:
        if DRY_RUN:
            return {"dry_run": True}, False
        script_path = ROOT_DIR / "mes_download.py"
        if not script_path.exists():
            raise FileNotFoundError("mes_download.py 파일을 찾을 수 없습니다.")
        self.cleanup_zombie_processes()
        process = subprocess.Popen(
            [sys.executable, str(script_path)], cwd=str(ROOT_DIR), stdout=subprocess.PIPE,
            # A single streamed pipe prevents an unread stderr buffer from
            # deadlocking a noisy child while preserving every line as UTF-8.
            stderr=subprocess.STDOUT, stdin=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
        )
        output: list[str] = []
        output_queue: queue.Queue[str | None] = queue.Queue()
        def read_output() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                output_queue.put(line)
            output_queue.put(None)
        output_reader = threading.Thread(target=read_output, daemon=True)
        output_reader.start()
        effect_started = False
        def approve_effect_start() -> None:
            nonlocal effect_started
            allowed = False
            if not self.cancel_requested.is_set():
                allowed = self.allow_effect_start(str(self.current_job_id))
            if not allowed:
                if process.stdin is not None:
                    process.stdin.write(json.dumps({"allow": allowed}) + "\n")
                    process.stdin.flush()
                raise RuntimeError("MES_EFFECT_PERMISSION_DENIED")

            # The durable marker is the irreversible boundary.  Cross the
            # in-memory boundary before sending allow=true: a BrokenPipe,
            # flush failure, or child exit after this point means the child
            # may have received permission and must be treated as uncertain.
            effect_started = True
            self.current_job_effect_started = True
            if process.stdin is not None:
                process.stdin.write(json.dumps({"allow": True}) + "\n")
                process.stdin.flush()
        started = time.monotonic()
        last_lease_renewal = started
        while process.poll() is None:
            while not output_queue.empty():
                line = output_queue.get_nowait()
                if line is None: continue
                output.append(line)
                if line.strip() == "AUTOMATION_EVENT:effect_start_request":
                    approve_effect_start()
            if time.monotonic() - last_lease_renewal >= LEASE_HEARTBEAT_SECONDS:
                self.supabase.rpc("renew_automation_job_lease", {
                    "p_job_id": self.current_job_id, "p_worker_id": self.worker_id,
                }).execute()
                last_lease_renewal = time.monotonic()
            if self.cancel_requested.is_set():
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                self.cleanup_zombie_processes()
                raise RuntimeError(
                    "CANCEL_REQUESTED_AFTER_EFFECT_START"
                    if effect_started else "CANCEL_REQUESTED_BEFORE_EFFECT"
                )
            if time.monotonic() - started > MACRO_TIMEOUT_SECONDS:
                process.terminate()
                raise RuntimeError("MES_MACRO_TIMEOUT")
            time.sleep(0.5)
        # The reader owns stdout.  Do not call communicate() after streaming
        # it; wait for EOF and drain queued lines so no event/log is lost.
        output_reader.join(timeout=2)
        while True:
            try:
                line = output_queue.get_nowait()
            except queue.Empty:
                break
            if line is not None:
                output.append(line)
                if line.strip() == "AUTOMATION_EVENT:effect_start_request":
                    approve_effect_start()
        if process.returncode:
            raise RuntimeError(("".join(output) or f"exit code {process.returncode}")[-3000:])
        # mes_download.py only exits successfully after both upload API calls have
        # returned success, which is this worker's DB-effect acknowledgement.
        return {"stdout_tail": "".join(output)[-2000:], "stderr_tail": "", "syncSuccess": True}, effect_started

    def process_next(self) -> bool:
        job = self.claim()
        if not job:
            return False
        job_id = str(job["id"])
        self.current_job_id = job_id
        self.current_job_effect_started = False
        self.cancel_requested.clear()
        effect_started = False
        try:
            if job.get("status") == "CANCEL_REQUESTED":
                self.update(job_id, status="CANCELLED", progress_stage="취소됨", progress_percent=100)
                return True
            self.update(job_id, progress_stage="MES 자료 추출", progress_percent=20)
            self.update(job_id, progress_stage="MES/Excel 실행", progress_percent=35)
            result, effect_started = self.run_macro()
            self.update(
                job_id, status="COMPLETED", progress_stage="DB 반영 확인", progress_percent=100,
                result_code="MES_SYNC_CONFIRMED", result_payload=result, error_code=None,
                error_message=None, effect_confirmed_at=now(), finished_at=now(),
            )
            self.drain_post_sync()
        except Exception as error:
            code = str(error)
            if code in {"CANCEL_REQUESTED_BEFORE_EFFECT", "MES_EFFECT_PERMISSION_DENIED"} and not self.current_job_effect_started:
                self.update(job_id, status="CANCELLED", progress_stage="사용자 취소", progress_percent=100,
                            result_code="USER_CANCELLED", finished_at=now())
            elif code == "CANCEL_REQUESTED_AFTER_EFFECT_START" or effect_started or self.current_job_effect_started:
                self.update(
                    job_id, status="CONFIRM_REQUIRED", progress_stage="효과 확인 필요", progress_percent=100,
                    result_code="MES_EFFECT_UNCERTAIN", error_code=code[:100], error_message=traceback.format_exc()[-3000:],
                    finished_at=now(),
                )
            else:
                self.update(
                    job_id, status="FAILED", progress_stage="실패", progress_percent=100,
                    error_code=code[:100], error_message=traceback.format_exc()[-3000:], finished_at=now(),
                )
        finally:
            self.current_job_id = None
            self.current_job_effect_started = False
            self.cancel_requested.clear()
        return True


async def run_worker() -> None:
    worker = MesWorker()
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    realtime_key = os.getenv("SUPABASE_REALTIME_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    if not url or not realtime_key:
        raise RuntimeError("Realtime 환경 변수가 없습니다.")
    wake = asyncio.Event()
    wake.set()  # startup one-time reconciliation
    loop = asyncio.get_running_loop()

    def drain() -> None:
        worker.reconcile_stale_jobs()
        while worker.process_next():
            pass

    async def subscribe_once() -> None:
        client = SupabaseRealtimePostgresClient(url, realtime_key)
        await client.connect()
        channel = client.channel("automation-mes-worker")

        def on_event(payload: dict[str, Any]) -> None:
            record = ((payload.get("data") or {}).get("record") or payload.get("payload") or {})
            if isinstance(record, dict) and record.get("job_type") == MES_JOB_TYPE:
                worker.on_signal(record)
                loop.call_soon_threadsafe(wake.set)

        channel.on_postgres_changes(event="*", schema="public", table="automation_job_signals", filter="job_type=eq.MES_SYNC", callback=on_event)
        await channel.subscribe()
        wake.set()  # reconnect one-time reconciliation
        try:
            while client.is_connected:
                wake_task = asyncio.create_task(wake.wait())
                background = {task for task in (client._listen_task, client._heartbeat_task) if task is not None}
                done, _ = await asyncio.wait(background | {wake_task}, return_when=asyncio.FIRST_COMPLETED)
                if wake_task not in done:
                    wake_task.cancel()
                if any(task in done for task in background) or not client.is_connected:
                    raise ConnectionError("MES Realtime 연결이 종료되었습니다.")
                wake.clear()
                await asyncio.to_thread(drain)
                # The worker is drained by the event. No timed DB polling occurs.
        finally:
            await channel.unsubscribe()
            await client.close()

    failure = 0
    while True:
        try:
            await subscribe_once()
            failure = 0
        except Exception as error:
            failure += 1
            delay = RECOVERY_DELAYS[min(failure - 1, len(RECOVERY_DELAYS) - 1)]
            print(f"[MES Worker] Realtime 연결 오류: {error}; {delay}초 후 재시도")
            await asyncio.sleep(delay)


if __name__ == "__main__":
    asyncio.run(run_worker())
