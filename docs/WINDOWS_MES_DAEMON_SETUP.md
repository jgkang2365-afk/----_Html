# Windows MES Daemon 설치 및 Realtime 확인

MES 실행 PC에서는 프로젝트 루트에서 전용 가상환경을 만들고 정식 의존성 파일로 설치합니다.

```powershell
py -3 -m venv .venv-mes-daemon
.\.venv-mes-daemon\Scripts\python.exe -m pip install --upgrade pip
.\.venv-mes-daemon\Scripts\python.exe -m pip install -r requirements-mes-daemon.in
```

`requirements-mes-daemon.in`은 이 저장소를 editable package로 설치합니다. 따라서 프로젝트
내부 Realtime 클라이언트도 현재 작업 디렉터리와 무관하게 다음 import로 사용할 수 있습니다.

```powershell
.\.venv-mes-daemon\Scripts\python.exe -c "from supabase_realtime_postgres_changes import SupabaseRealtimePostgresClient; print('OK')"
```

설치되는 MES 런타임 배포물과 외부 패키지 버전은 `pyproject.toml`에 고정되어 있습니다.

- `measurement-journal-mes-runtime==0.1.0` (프로젝트 내부 배포물)
- `supabase==2.31.0`
- `python-dotenv==1.2.2`
- `websockets==15.0.1`

`websockets==15.0.1`은 `supabase==2.31.0`이 요구하는 `realtime==2.31.0`의
`websockets>=11,<16` 범위와 호환되며, 이 프로젝트의 직접 Realtime 클라이언트가 사용하는
`websockets.asyncio.client` API도 제공합니다.

## 실제 Realtime 구독 smoke test

프로젝트의 `.env.local` 또는 `.env`에 기존 Supabase 환경 변수가 준비된 상태에서 실행합니다.

```powershell
.\.venv-mes-daemon\Scripts\python.exe mes_daemon.py --realtime-smoke-test
```

이 모드는 `mes_sync_queue` Realtime 채널을 초기화하고 구독 성공을 확인한 뒤 즉시 연결을
정리합니다. pending 조회, DB 상태 변경, `mes_download.py` 실행은 하지 않습니다.

정상 설치 후 `run-mes-daemon.bat`과 `mes-tray.ps1`은 `.venv-mes-daemon`의 Python을
우선 사용하고, 가상환경이 없을 때만 기존 시스템 Python 탐색 방식으로 동작합니다.
