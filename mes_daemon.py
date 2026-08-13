import asyncio
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from mes_daemon_realtime import (
    DEFAULT_SAFETY_CHECK_SECONDS,
    MesDaemonRuntime,
    MesRealtimeSettings,
    MesWakeCoordinator,
    effective_safety_check_seconds,
    env_flag,
    smoke_test_subscription,
)


try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from supabase import create_client
except ImportError:
    print(
        "[MES Daemon] Python 의존성이 없습니다. "
        "먼저 `.venv-mes-daemon\\Scripts\\python.exe -m pip install "
        "-r requirements-mes-daemon.in`을 실행하세요."
    )
    raise


ROOT_DIR = Path(__file__).resolve().parent

if load_dotenv:
    load_dotenv(ROOT_DIR / ".env.local")
    load_dotenv(ROOT_DIR / ".env")

QUEUE_ID = 1
IDLE_RESET_SECONDS = int(os.getenv("MES_DAEMON_IDLE_RESET_SECONDS", "10"))
MACRO_TIMEOUT_SECONDS = int(os.getenv("MES_DAEMON_MACRO_TIMEOUT_SECONDS", "600"))
DRY_RUN = os.getenv("MES_DAEMON_DRY_RUN", "").lower() in ("1", "true", "yes", "y")


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_supabase_config():
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "Supabase 환경 변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY "
            "또는 SUPABASE_URL/SUPABASE_KEY를 설정하세요."
        )

    return supabase_url, supabase_key


SUPABASE_URL, SUPABASE_KEY = get_supabase_config()
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def update_queue(status, error_message=None):
    payload = {
        "status": status,
        "error_message": error_message,
        "updated_at": utc_now_iso(),
    }
    supabase.table("mes_sync_queue").update(payload).eq("id", QUEUE_ID).execute()


def is_cancel_requested():
    response = supabase.table("mes_sync_queue").select("status").eq("id", QUEUE_ID).single().execute()
    return bool(response.data and response.data.get("status") == "cancel_requested")


def cleanup_zombie_processes():
    print("[MES Daemon] 잔여 Excel/MES 프로세스를 정리합니다.")
    for image_name in ("excel.exe", "hwsmes.exe"):
        try:
            subprocess.run(
                ["taskkill", "/f", "/im", image_name],
                capture_output=True,
                text=True,
                check=False,
            )
        except Exception as exc:
            print(f"[MES Daemon] {image_name} 정리 중 경고: {exc}")


def is_windows_admin():
    if os.name != "nt":
        return True

    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def run_mes_macro():
    if DRY_RUN:
        print("[MES Daemon] DRY_RUN 모드입니다. mes_download.py 실행 없이 성공 처리합니다.")
        return

    script_path = ROOT_DIR / "mes_download.py"
    if not script_path.exists():
        raise FileNotFoundError(f"mes_download.py 파일을 찾을 수 없습니다: {script_path}")

    if not is_windows_admin():
        raise RuntimeError("mes_daemon.py는 관리자 권한으로 실행되어야 합니다.")

    cleanup_zombie_processes()
    print(f"[MES Daemon] MES 매크로를 실행합니다: {script_path}")

    process = subprocess.Popen(
        [sys.executable, str(script_path)],
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    started_at = time.monotonic()
    while process.poll() is None:
        if is_cancel_requested():
            print("[MES Daemon] 웹에서 중단 요청을 받았습니다. MES 매크로를 종료합니다.")
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
            cleanup_zombie_processes()
            raise RuntimeError("USER_CANCELLED")

        if time.monotonic() - started_at > MACRO_TIMEOUT_SECONDS:
            process.terminate()
            raise subprocess.TimeoutExpired(process.args, MACRO_TIMEOUT_SECONDS)

        time.sleep(1)

    stdout, stderr = process.communicate()

    if stdout:
        print("[MES Daemon] mes_download.py stdout:")
        print(stdout)

    if stderr:
        print("[MES Daemon] mes_download.py stderr:")
        print(stderr)

    if process.returncode != 0:
        detail = stderr.strip() or stdout.strip() or f"exit code {process.returncode}"
        raise RuntimeError(detail[-3000:])


def claim_pending_request():
    response = (
        supabase.table("mes_sync_queue")
        .update({"status": "running", "error_message": None, "updated_at": utc_now_iso()})
        .eq("id", QUEUE_ID)
        .eq("status", "pending")
        .execute()
    )
    return bool(response.data)


def handle_claimed_request():
    print("[MES Daemon] pending 요청을 선점했습니다.")

    try:
        run_mes_macro()
        update_queue("success")
        print("[MES Daemon] MES 동기화가 완료되었습니다.")
    except RuntimeError as exc:
        if str(exc) == "USER_CANCELLED":
            update_queue("cancelled", "사용자가 중단 요청을 실행했습니다.")
            print("[MES Daemon] 사용자의 요청으로 MES 동기화를 중단했습니다.")
        else:
            message = f"{exc}\n{traceback.format_exc()}"
            update_queue("error", message[-3000:])
            print("[MES Daemon] MES 동기화 실패:")
            print(message)
    except subprocess.TimeoutExpired:
        message = f"MES 매크로 실행 시간이 {MACRO_TIMEOUT_SECONDS}초를 초과했습니다."
        update_queue("error", message)
        print(f"[MES Daemon] {message}")
    except Exception as exc:
        message = f"{exc}\n{traceback.format_exc()}"
        update_queue("error", message[-3000:])
        print("[MES Daemon] MES 동기화 실패:")
        print(message)
    finally:
        time.sleep(IDLE_RESET_SECONDS)
        try:
            response = supabase.table("mes_sync_queue").select("status").eq("id", QUEUE_ID).single().execute()
            current_status = response.data.get("status") if response.data else None
            if current_status in ("success", "error", "cancelled"):
                update_queue("idle")
                print("[MES Daemon] 다음 요청을 받을 수 있도록 idle 상태로 복귀했습니다.")
        except Exception as exc:
            print(f"[MES Daemon] idle 복귀 중 오류: {exc}")


def check_and_handle_pending():
    response = supabase.table("mes_sync_queue").select("status").eq("id", QUEUE_ID).single().execute()
    status = response.data.get("status") if response.data else None
    if status != "pending" or not claim_pending_request():
        return False
    handle_claimed_request()
    return True


async def run_daemon():
    print("[MES Daemon] MES 동기화 Realtime 데몬을 시작합니다.")
    settings = MesRealtimeSettings(
        enabled=env_flag(os.getenv("MES_DAEMON_REALTIME_ENABLED")),
        supabase_url=SUPABASE_URL,
        realtime_key=SUPABASE_KEY,
        safety_check_seconds=effective_safety_check_seconds(
            os.getenv("MES_DAEMON_SAFETY_CHECK_SECONDS")
        ),
    )
    runtime = MesDaemonRuntime(MesWakeCoordinator(check_and_handle_pending), settings)
    await runtime.run()


async def run_realtime_smoke_test():
    """MES 작업이나 DB 조회 없이 Realtime 채널 연결과 구독만 검증한다."""
    settings = MesRealtimeSettings(
        enabled=True,
        supabase_url=SUPABASE_URL,
        realtime_key=SUPABASE_KEY,
        safety_check_seconds=DEFAULT_SAFETY_CHECK_SECONDS,
    )
    await smoke_test_subscription(settings)
    print("[MES Daemon] Realtime 구독 smoke test 성공: mes_sync_queue")


if __name__ == "__main__":
    try:
        if "--realtime-smoke-test" in sys.argv[1:]:
            asyncio.run(run_realtime_smoke_test())
        else:
            asyncio.run(run_daemon())
    except KeyboardInterrupt:
        print("[MES Daemon] 사용자 요청으로 종료합니다.")


