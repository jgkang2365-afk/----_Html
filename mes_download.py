import os
import sys
import time
import ctypes
import threading
import subprocess
import shutil
import traceback
import importlib.metadata

# 표준 출력을 UTF-8로 설정하여 Windows 콘솔(CP949) 한글/특수문자 출력 에러 방지
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


# ==========================================
# 0-0. 필수 라이브러리 자동 검사 및 무인 설치 (Dependency Harness)
# ==========================================
def install_dependencies():
    """ 
    실행 환경에 필수 외부 라이브러리가 설치되어 있는지 확인하고, 
    없을 경우 pip를 호출하여 사용자 개입 없이 자동으로 설치합니다.
    """
    # PyInstaller로 패키징된 실행 파일(.exe) 환경에서는 이미 의존성이 패키징되어 있으므로 자동 검사 및 설치를 건너뜁니다.
    if getattr(sys, 'frozen', False):
        return
        
    required_packages = {
        "pandas": ("pandas", None),
        "xlrd": ("xlrd", "2.0.1"),  # Pandas 최신 버전이 요구하는 xlrd 최소 사양 명시
        "openpyxl": ("openpyxl", None),
        "pywinauto": ("pywinauto", None),
        "requests": ("requests", None),
        "dotenv": ("python-dotenv", None),
        "win32com": ("pywin32", None)
    }
    
    missing_or_outdated = []
    for module_name, (package_name, min_version) in required_packages.items():
        try:
            # 먼저 임포트가 가능한지 확인
            __import__(module_name)
            
            # 임포트 성공 시 최소 버전 요구 조건이 있다면 검사
            if min_version:
                installed_ver = importlib.metadata.version(package_name)
                inst_parts = [int(x) for x in installed_ver.split('.') if x.isdigit()]
                min_parts = [int(x) for x in min_version.split('.') if x.isdigit()]
                if inst_parts < min_parts:
                    print(f"[-] '{package_name}' 버전이 너무 낮습니다 (설치됨: {installed_ver}, 요구됨: >={min_version})")
                    missing_or_outdated.append(package_name)
        except (ImportError, importlib.metadata.PackageNotFoundError):
            missing_or_outdated.append(package_name)
            
    if missing_or_outdated:
        print(f"[-] 누락되거나 업데이트가 필요한 라이브러리 발견: {missing_or_outdated}")
        print("[-] 백그라운드 무인 설치/업그레이드를 시작합니다. 잠시만 기다려주세요...")
        for pkg in missing_or_outdated:
            install_target = pkg
            if pkg == "xlrd":
                install_target = "xlrd>=2.0.1"
            if pkg == "python-dotenv":
                install_target = "python-dotenv"
                
            print(f"[-] '{install_target}' 설치/업데이트 중...")
            try:
                # --quiet 옵션과 --disable-pip-version-check를 사용해 로그를 간결하게 유지하고 에러 방지
                subprocess.check_call([
                    sys.executable, "-m", 
                    "pip", "install", 
                    "--upgrade",
                    install_target, 
                    "--quiet", 
                    "--disable-pip-version-check"
                ])
                print(f"[OK] '{pkg}' 라이브러리 설치/업데이트 성공.")
            except Exception as e:
                print(f"[오류] '{pkg}' 라이브러리 설치 중 심각한 에러가 발생했습니다: {e}")
                print("[-] 스크립트를 더 이상 진행할 수 없어 안전하게 종료합니다.")
                sys.exit(1)
        print("[✓] 모든 필수 라이브러리 설치 및 업데이트가 완료되었습니다.\n")

# 스크립트 진입 시 즉시 의존성 확인 및 설치 실행
install_dependencies()

# 의존성이 해결된 후 안전하게 외부 라이브러리 임포트
import pandas as pd
from datetime import datetime, timedelta
from pywinauto import Application
from pywinauto.keyboard import send_keys
from dotenv import load_dotenv
import requests

# ==========================================
# 0. 관리자 권한 확인 및 자동 승격 (성공 케이스 대조 반영)
# ==========================================
def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

if not is_admin():
    # 관리자 권한이 아니면 권한 상승 후 재실행
    print("[-] 관리자 권한으로 재실행을 시도합니다...")
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit()

# ==========================================
# 0-1. 전역 ESC 키 감시 및 비상 종료 훅 (오토핫키 Esc::ExitApp 매칭)
# ==========================================
def monitor_esc():
    """ 전역 ESC 키 입력을 감시하여 프로그램 발생 시 강제 종료하는 백그라운드 스레드 """
    user32 = ctypes.windll.user32
    while True:
        if user32.GetAsyncKeyState(0x1B) & 0x8000:
            print("\n[중단] 사용자가 ESC 키를 입력하여 프로세스를 즉시 강제 종료합니다.")
            os._exit(1)
        time.sleep(0.1)

# ==========================================
# 1. 환경 설정 및 변수 선언 (.env 환경변수 동적 로드)
# ==========================================
load_dotenv(dotenv_path=".env.local")
load_dotenv(dotenv_path=".env")

MES_EXE = os.getenv("MES_EXE", r"C:\HWS\MEA\hwsmes.exe")
PASSWORD = os.getenv("MES_PASSWORD", "rkdwhdrn")  # MES 접속 비밀번호
SAVE_PATH = os.getenv("MES_SAVE_PATH", r"Z:\data\측정팀\자동화 툴\MES 프로그램 DB") # 네트워크 백업 경로

# 웹 대시보드 로그인 및 API 전송 정보
WEB_API_URL = os.getenv("WEB_API_URL", "http://localhost:3000") # 업로드 대상 웹 서버 주소
WEB_USERNAME = os.getenv("WEB_USERNAME", "강종구")
WEB_PASSWORD = os.getenv("WEB_PASSWORD", "frn2314@")

# ==========================================
# Windows API 구조체 및 전역 선언 (가상 키코드 시뮬레이터)
# ==========================================
from ctypes import wintypes

user32 = ctypes.windll.user32

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t)
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t)
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD)
    ]

class INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT)
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("u", INPUT_UNION)
    ]

INPUT_KEYBOARD = 1
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_KEYUP = 0x0002

VK_TAB = 0x09
VK_RETURN = 0x0D
VK_LEFT = 0x25
VK_L = 0x4C
VK_MENU = 0x12 # Alt
VK_LMENU = 0xA4 # Left Alt
VK_N = 0x4E # 파일명 단축키 N

MAPVK_VK_TO_VSC = 0
user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
user32.MapVirtualKeyW.restype = wintypes.UINT

def type_text(text):
    """ Windows API SendInput을 활용하여 IME 상태와 무관하게 한글/영문/기호를 직접 타이핑하는 헬퍼 함수 """
    print(f"[-] 텍스트 타이핑 중: '{text}'")
    for char in text:
        # 눌림
        ki_press = KEYBDINPUT(wVk=0, wScan=ord(char), dwFlags=KEYEVENTF_UNICODE, time=0, dwExtraInfo=0)
        input_press = INPUT(type=INPUT_KEYBOARD, u=INPUT_UNION(ki=ki_press))
        res_down = user32.SendInput(1, ctypes.byref(input_press), ctypes.sizeof(INPUT))
        
        # 뗌
        ki_release = KEYBDINPUT(wVk=0, wScan=ord(char), dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
        input_release = INPUT(type=INPUT_KEYBOARD, u=INPUT_UNION(ki=ki_release))
        res_up = user32.SendInput(1, ctypes.byref(input_release), ctypes.sizeof(INPUT))
        
        if res_down == 0 or res_up == 0:
            print(f"[경고] 글자 '{char}' 입력 실패 (down={res_down}, up={res_up})")
        time.sleep(0.02) # 타이핑 안정성을 위한 미세 지연

def press_key(vk_code):
    """ 가상 키코드(vk_code)를 누르고 떼는 물리 키 시뮬레이션 (스캔코드 매핑 포함) """
    key_names = {VK_TAB: "Tab", VK_RETURN: "Enter", VK_LEFT: "Left", VK_L: "L", VK_MENU: "Alt", VK_LMENU: "Left Alt", VK_N: "N"}
    key_name = key_names.get(vk_code, f"0x{vk_code:02X}")
    
    scan_code = user32.MapVirtualKeyW(vk_code, MAPVK_VK_TO_VSC)
    
    # 누름
    input_down = INPUT(type=INPUT_KEYBOARD, u=INPUT_UNION(ki=KEYBDINPUT(wVk=vk_code, wScan=scan_code, dwFlags=0, time=0, dwExtraInfo=0)))
    res_down = user32.SendInput(1, ctypes.byref(input_down), ctypes.sizeof(INPUT))
    time.sleep(0.05)
    
    # 뗌
    input_up = INPUT(type=INPUT_KEYBOARD, u=INPUT_UNION(ki=KEYBDINPUT(wVk=vk_code, wScan=scan_code, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)))
    res_up = user32.SendInput(1, ctypes.byref(input_up), ctypes.sizeof(INPUT))
    time.sleep(0.05)
    
    if res_down == 0 or res_up == 0:
        print(f"[경고] 키 '{key_name}' 입력 실패 (down={res_down}, up={res_up})")
    else:
        print(f"[-] 키 '{key_name}' 입력 성공")

def press_ctrl_key(vk_code):
    """ Ctrl + vk_code 단축키 물리 시뮬레이션 (원자적 4키 배열 전송, 스캔코드 매핑 포함) """
    VK_CONTROL = 0x11
    scan_ctrl = user32.MapVirtualKeyW(VK_CONTROL, MAPVK_VK_TO_VSC)
    scan_key = user32.MapVirtualKeyW(vk_code, MAPVK_VK_TO_VSC)
    
    key_names = {VK_L: "L", VK_TAB: "Tab", VK_RETURN: "Enter"}
    key_name = key_names.get(vk_code, f"0x{vk_code:02X}")
    print(f"[-] Ctrl + {key_name} 단축키 조합 전송 시도...")
    
    inputs = (INPUT * 4)()
    
    # Ctrl Down
    inputs[0].type = INPUT_KEYBOARD
    inputs[0].u.ki = KEYBDINPUT(wVk=VK_CONTROL, wScan=scan_ctrl, dwFlags=0, time=0, dwExtraInfo=0)
    
    # Key Down
    inputs[1].type = INPUT_KEYBOARD
    inputs[1].u.ki = KEYBDINPUT(wVk=vk_code, wScan=scan_key, dwFlags=0, time=0, dwExtraInfo=0)
    
    # Key Up
    inputs[2].type = INPUT_KEYBOARD
    inputs[2].u.ki = KEYBDINPUT(wVk=vk_code, wScan=scan_key, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
    
    # Ctrl Up
    inputs[3].type = INPUT_KEYBOARD
    inputs[3].u.ki = KEYBDINPUT(wVk=VK_CONTROL, wScan=scan_ctrl, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
    
    res = user32.SendInput(4, ctypes.byref(inputs), ctypes.sizeof(INPUT))
    if res != 4:
        print(f"[경고] Ctrl + {key_name} 단축키 전송 실패 (결과: {res}/4)")
    else:
        print(f"[OK] Ctrl + {key_name} 단축키 전송 성공")
    time.sleep(0.05)

def press_alt_key(vk_code):
    """ Alt + vk_code 단축키 물리 시뮬레이션 (원자적 4키 배열 전송, 스캔코드 매핑 포함) """
    VK_ALT = 0x12
    scan_alt = user32.MapVirtualKeyW(VK_ALT, MAPVK_VK_TO_VSC)
    scan_key = user32.MapVirtualKeyW(vk_code, MAPVK_VK_TO_VSC)
    
    key_names = {VK_N: "N", VK_L: "L", VK_TAB: "Tab", VK_RETURN: "Enter"}
    key_name = key_names.get(vk_code, f"0x{vk_code:02X}")
    print(f"[-] Alt + {key_name} 단축키 조합 전송 시도...")
    
    inputs = (INPUT * 4)()
    
    # Alt Down
    inputs[0].type = INPUT_KEYBOARD
    inputs[0].u.ki = KEYBDINPUT(wVk=VK_ALT, wScan=scan_alt, dwFlags=0, time=0, dwExtraInfo=0)
    
    # Key Down
    inputs[1].type = INPUT_KEYBOARD
    inputs[1].u.ki = KEYBDINPUT(wVk=vk_code, wScan=scan_key, dwFlags=0, time=0, dwExtraInfo=0)
    
    # Key Up
    inputs[2].type = INPUT_KEYBOARD
    inputs[2].u.ki = KEYBDINPUT(wVk=vk_code, wScan=scan_key, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
    
    # Alt Up
    inputs[3].type = INPUT_KEYBOARD
    inputs[3].u.ki = KEYBDINPUT(wVk=VK_ALT, wScan=scan_alt, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
    
    res = user32.SendInput(4, ctypes.byref(inputs), ctypes.sizeof(INPUT))
    if res != 4:
        print(f"[경고] Alt + {key_name} 단축키 전송 실패 (결과: {res}/4)")
    else:
        print(f"[✓] Alt + {key_name} 단축키 전송 성공")
    time.sleep(0.05)

LOGIN_TITLE = "Login"
MAIN_TITLE = "MES - Ver"

# 날짜 동적 연산: 오늘 기준 3개월 전 ~ 오늘로 조회 범위 단축 (기존 확정 데이터 유실 방지)
three_months_ago = datetime.now() - timedelta(days=90)
START_DATE = three_months_ago.strftime("%Y%m%d")
END_DATE = datetime.now().strftime("%Y%m%d") # 오늘 날짜 (yyyyMMdd)

# ==========================================
# 2. 엑셀 초고속 가공 함수
# ==========================================
def convert_and_copy_excel_files(filenames):
    """
    네트워크의 복수 .xls 파일들을 로컬 Temp 폴더로 먼저 복사한 후,
    엑셀 백그라운드 프로세스를 단 1회만 구동하여 초고속으로 .xlsx 변환을 완료하고
    결과물을 다시 네트워크 경로로 전송합니다. (네트워크 경로 오류 시 C:\\Temp 로컬 백업 자동 우회)
    """
    os.makedirs("C:\\Temp", exist_ok=True)
    
    # 기존에 남아있는 좀비 엑셀 프로세스가 락을 잡고 있으면 해제
    try:
        subprocess.run(["taskkill", "/f", "/im", "excel.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.5)
    except Exception:
        pass
        
    import win32com.client as win32
    print("[-] 엑셀 백그라운드 변환 엔진 초기화 중...")
    excel = win32.Dispatch('Excel.Application')
    excel.Visible = False
    excel.DisplayAlerts = False
    
    target_xlsx_files = []
    
    try:
        for filename in filenames:
            src_xls = os.path.join(SAVE_PATH, filename)
            base_name = os.path.splitext(filename)[0]
            
            local_xls = f"C:\\Temp\\{filename}"
            temp_xlsx = f"C:\\Temp\\{base_name}.xlsx"
            target_xlsx = os.path.join(SAVE_PATH, f"{base_name}.xlsx")
            
            print(f"[-] {filename} 가공 및 .xlsx 변환 진행 중...")
            
            # 네트워크 드라이브 경로가 연결되어 있지 않은 경우 예외 가드 및 로컬 우회
            if not os.path.exists(src_xls):
                print(f"[경고] 네트워크 경로의 원본 파일이 없습니다: {src_xls}")
                # 로컬에 원본 임시파일이 있으면 그것을 소스로 사용
                if os.path.exists(local_xls):
                    print(f"[-] 로컬 C:\\Temp 임시 원본을 사용하여 변환합니다: {local_xls}")
                else:
                    raise FileNotFoundError(f"변환할 원본 파일이 존재하지 않습니다: {src_xls} 및 {local_xls}")
            else:
                # 1. 네트워크 드라이브에서 로컬 C:\Temp로 원본 xls 복사 (네트워크 병목 방지)
                shutil.copy(src_xls, local_xls)
            
            # 2. 로컬 디스크의 xls를 엑셀 프로세스로 열기
            wb = excel.Workbooks.Open(local_xls)
            
            # 3. 로컬 C:\Temp에 xlsx 파일로 저장
            if os.path.exists(temp_xlsx):
                os.remove(temp_xlsx)
            wb.SaveAs(temp_xlsx, FileFormat=51) # 51 = xlOpenXMLWorkbook (.xlsx)
            wb.Close()
            
            # 4. 로컬 xlsx를 다시 네트워크 드라이브로 전송 (네트워크 장애 시 로컬 백업 폴더 fallback 우회)
            try:
                os.makedirs(os.path.dirname(target_xlsx), exist_ok=True)
                shutil.copy(temp_xlsx, target_xlsx)
                print(f"[✓] {base_name}.xlsx 변환 및 네트워크 전송 완료.")
            except Exception as net_err:
                fallback_xlsx = os.path.join("C:\\Temp", f"{base_name}.xlsx")
                if not os.path.samefile(temp_xlsx, fallback_xlsx):
                    shutil.copy(temp_xlsx, fallback_xlsx)
                print(f"[경고] 네트워크 경로({SAVE_PATH}) 전송 실패. 로컬 백업 경로({fallback_xlsx})로 저장했습니다. 에러: {net_err}")
                target_xlsx = fallback_xlsx
            
            # 로컬 임시 xls 파일 정리
            try:
                os.remove(local_xls)
            except Exception:
                pass
                
            target_xlsx_files.append(target_xlsx)
            
        return target_xlsx_files
        
    except Exception as e:
        print(f"[오류] 엑셀 일괄 가공/변환 중 에러 발생: {e}")
        print(traceback.format_exc())
        raise e
    finally:
        try:
            excel.Quit()
        except Exception:
            pass

# ==========================================
# MAIN AUTOMATION PROCESS
# ==========================================
def main():
    # ESC 키 전역 감시 스레드 구동 (비상 종료 훅)
    threading.Thread(target=monitor_esc, daemon=True).start()

    print("[시작] 통합 자동화 봇 가동")

    # 0. 중복 기동 및 좀비 프로세스 락 방지를 위한 사전 프로세스 강제 정리
    print("[-] 이전 중복 기동 방지를 위해 기존 프로그램 인스턴스 종료 시도...")
    try:
        subprocess.run(["taskkill", "/f", "/im", "excel.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["taskkill", "/f", "/im", "hwsmes.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.0)
    except Exception:
        pass

    # 0-1. 덮어쓰기 팝업 강제 유도를 위한 빈 파일 터치(Touch) 안전 장치
    print("[-] 덮어쓰기 팝업 활성화를 위해 기존 파일 유무 점검 및 임시 Touch 수행...")
    try:
        os.makedirs(SAVE_PATH, exist_ok=True)
        required_files = [
            os.path.join(SAVE_PATH, "measurement_business.xls"),
            os.path.join(SAVE_PATH, "business_info.xls")
        ]
        for req_f in required_files:
            if not os.path.exists(req_f):
                try:
                    with open(req_f, "w") as f:
                        f.write("")
                    print(f"[OK] 빈 임시 파일 생성 완료 (Touch): {os.path.basename(req_f)}")
                except Exception as f_err:
                    print(f"[경고] 임시 파일 생성 실패 ({os.path.basename(req_f)}): {f_err}")
            else:
                print(f"[-] 기존 파일 존재 확인 (덮어쓰기 팝업 발생 조건 충족): {os.path.basename(req_f)}")
    except Exception as dir_err:
        print(f"[경고] 네트워크 경로(SAVE_PATH) 생성 불가로 로컬 Temp 에 대체 파일 생성 시도: {dir_err}")
        # Z 드라이브 권한이 없을 경우 로컬 C:\Temp 에 임시 파일 생성
        os.makedirs("C:\\Temp", exist_ok=True)
        required_files = [
            r"C:\Temp\measurement_business.xls",
            r"C:\Temp\business_info.xls"
        ]
        for req_f in required_files:
            if not os.path.exists(req_f):
                with open(req_f, "w") as f:
                    f.write("")

    # 1. MES 프로그램 실행
    print("[-] MES 프로그램을 실행합니다.")
    try:
        subprocess.Popen([MES_EXE])
    except Exception as run_err:
        print(f"[치명적 오류] MES 프로그램 실행 실패 ({MES_EXE}): {run_err}")
        sys.exit(1)
    
    # pywinauto를 이용한 윈도우 객체 제어 연결
    app = Application(backend="win32")
    
    # 2. 로그인 창 대기 및 제어 (타이아웃 30초)
    print("[-] 로그인 창 대기 중...")
    time.sleep(3) # 프로그램 초기 구동 대기
    
    try:
        login_win = app.connect(title_re=LOGIN_TITLE, timeout=30).window(title_re=LOGIN_TITLE)
        login_win.set_focus()
        time.sleep(0.5)
        
        # ID 칸으로 이동 후 초기화 (Shift+Tab -> Ctrl+A -> Backspace)
        send_keys("+{TAB}")
        time.sleep(0.3)
        send_keys("^a{BACKSPACE}")
        time.sleep(0.3)
        
        # 이름 및 암호 입력 (강종구)
        send_keys("강종구{ENTER}")
        time.sleep(0.5)
        send_keys(f"{PASSWORD}{{ENTER}}")
        print("[OK] 로그인 정보 입력 완료.")
    except Exception as e:
        print(f"[오류] 로그인 창 제어 실패: {e}")
        raise RuntimeError(f"로그인 창 제어 실패: {e}")

    # 3. 메인 화면 및 초기 팝업 대기
    print("[-] 메인 화면 진입 대기 중...")
    try:
        main_win = app.connect(title_re=MAIN_TITLE, timeout=30).window(title_re=MAIN_TITLE)
        main_win.set_focus()
        time.sleep(2)
        
        # 초기 공지 팝업 3개 닫기 시퀀스 (Tab -> Space)
        for _ in range(3):
            send_keys("{TAB}")
            time.sleep(0.2)
            send_keys("{SPACE}")
            time.sleep(0.5)
        print("[OK] 초기 팝업 처리 완료.")
    except Exception as e:
        print(f"[주의] 메인 창 또는 팝업 제어 중 확인 필요: {e}")

    # 4. 메뉴 이동 (측정사업장)
    print("[-] 측정사업장 메뉴로 이동합니다.")
    main_win.set_focus()
    send_keys("{VK_MENU}") # Alt키 활성화
    time.sleep(0.8)
    send_keys("{DOWN}{RIGHT}{RIGHT}{ENTER}")
    time.sleep(2)

    # 5. 날짜 입력 및 조회 (F2)
    print(f"[-] 조회 기간 설정: {START_DATE} ~ {END_DATE}")
    send_keys("{F2}")
    time.sleep(0.5)
    send_keys(START_DATE)
    time.sleep(1)
    send_keys("{TAB}")
    time.sleep(1)
    send_keys(END_DATE)
    time.sleep(1)
    send_keys("{ENTER 2}")
    print("[-] 데이터 조회 중 (6초 대기)...")
    time.sleep(6)

    # 6. 첫 번째 DB 저장 (measurement_business)
    print("[-] 측정사업장 DB 저장 중...")
    send_keys("{F11}")
    time.sleep(3.0)  # Wait(3000)
    
    # 만약 네트워크 드라이브(Z)가 연결이 안 되어 있을 경우 C:\Temp에 저장하도록 우회
    current_save_path = SAVE_PATH
    if not os.path.exists(SAVE_PATH):
        current_save_path = "C:\\Temp"
        print(f"[경고] 네트워크 경로 미존재로 파일 저장 폴더를 우회합니다: {current_save_path}")

    # 파일 대화상자가 열리면 기본적으로 파일 이름 입력창에 포커스가 맞춰져 있습니다.
    # 여기에 절대경로를 포함한 파일명을 직접 입력하여 경로 이동과 파일 저장을 한 번에 완료합니다.
    full_save_path = os.path.join(current_save_path, "measurement_business")
    print(f"[-] 파일 이름 창에 전체 저장 절대 경로 입력 시도: '{full_save_path}'")
    type_text(full_save_path)
    time.sleep(0.5)
    
    print("[-] 저장 실행 엔터 전송...")
    press_key(VK_RETURN)
    print("[-] 저장 처리 진행 대기 (1.5초)...")
    time.sleep(1.5)  # Wait(1500)
    
    # 오토핫키 사양 1:1 매칭 저장 시퀀스 (30초 대기 및 덮어쓰기)
    print("[-] 덮어쓰기 수락을 위해 Left + Enter 전송...")
    press_key(VK_LEFT)
    press_key(VK_RETURN)
    print("[-] 1.5초 대기...")
    time.sleep(1.5)  # Wait(1500)
    
    print("[-] 추가 엔터 전송...")
    press_key(VK_RETURN)
    
    print("[-] 자료 저장 완료 팝업 대기 중 (최대 5분)...")
    start_wait = time.time()
    popup_found = False
    while time.time() - start_wait < 300:
        try:
            confirm_win = app.window(title="확인", class_name="#32770")
            if confirm_win.exists():
                if confirm_win.child_window(title_re=".*자료.*저장.*").exists():
                    print("[OK] 자료 저장 완료 팝업 감지 완료.")
                    popup_found = True
                    break
        except Exception:
            pass
        time.sleep(0.5)
        
    if not popup_found:
        print("[경고] 5분 동안 자료 저장 완료 팝업이 감지되지 않았습니다. 계속 진행합니다.")
        
    print("[-] 완료 팝업 확인 엔터 전송...")
    press_key(VK_RETURN)
    print("[-] 1.5초 대기...")
    time.sleep(1.5)  # Wait(1500)

    # 7. 두 번째 DB 저장 (business_info)
    print("[-] 사업장정보 DB 다운로드 시작...")
    send_keys("{VK_MENU}")
    time.sleep(0.8)  # Wait(800)
    send_keys("{DOWN}{ENTER}")
    time.sleep(2.0)  # Wait(2000)
    
    send_keys("{F11}")
    time.sleep(3.0)  # Wait(3000)
    
    # 파일 대화상자가 열리면 기본적으로 파일 이름 입력창에 포커스가 맞춰져 있습니다.
    # 여기에 절대경로를 포함한 파일명을 직접 입력하여 경로 이동과 파일 저장을 한 번에 완료합니다.
    full_save_path2 = os.path.join(current_save_path, "business_info")
    print(f"[-] 파일 이름 창에 전체 저장 절대 경로 입력 시도: '{full_save_path2}'")
    type_text(full_save_path2)
    time.sleep(0.5)
    
    print("[-] 저장 실행 엔터 전송...")
    press_key(VK_RETURN)
    print("[-] 저장 처리 진행 대기 (3.0초)...")
    time.sleep(3.0)  # Wait(3000)
    
    # 오토핫키 사양 1:1 매칭 저장 시퀀스 (15초 대기 및 덮어쓰기)
    print("[-] 덮어쓰기 수락을 위해 Left + Enter 전송...")
    press_key(VK_LEFT)
    press_key(VK_RETURN)
    print("[-] 3.0초 대기...")
    time.sleep(3.0)  # Wait(3000)
    
    print("[-] 추가 엔터 전송...")
    press_key(VK_RETURN)
    
    print("[-] 데이터 파일 파일 생성 대기 (5초)...")
    time.sleep(5.0)  # Wait(5000)

    # 8. MES 종료 시퀀스
    print("[-] MES 프로그램을 안전하게 종료합니다.")
    try:
        main_win.set_focus()
        send_keys("%{F4}") # Alt+F4
        time.sleep(1)
        send_keys("%{F4}")
        time.sleep(1)
    except Exception:
        # 종료 과정에서 혹시 오류가 나더라도 taskkill로 백업 클린업 수행
        pass
    
    try:
        subprocess.run(["taskkill", "/f", "/im", "hwsmes.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    # 9. 파이썬 내부 백그라운드 엑셀 가공 처리
    print("[4] 다운로드된 엑셀 가공 데이터 처리 시작...")
    local_upload_files = []
    try:
        # 만약 SAVE_PATH 네트워크 경로가 없는 경우, 임시 우회 저장 폴더(C:\Temp)에서 읽어서 가공하도록 fallback
        actual_filenames = ["measurement_business.xls", "business_info.xls"]
        # target_path 디렉토리가 존재하는지 점검
        if not os.path.exists(SAVE_PATH):
            print("[-] 네트워크 경로 미존재로 로컬 임시 변환을 적용합니다.")
            
        local_upload_files = convert_and_copy_excel_files(actual_filenames)
    except Exception as excel_err:
        print(f"[치명적 오류] 엑셀 데이터 가공 단계에서 처리가 중단되었습니다: {excel_err}")
        print("[-] 프로세스를 비정상 종료합니다. flag 파일은 생성되지 않습니다.")
        raise excel_err

    # 10. 웹 대시보드 API 직접 호출 업로드 (Selenium 크롬 브라우저 전면 제거)
    print("[5] 웹 대시보드 API 직접 호출 업로드 시작...")
    
    session = requests.Session()
    
    # 10-1. API 로그인 처리 (세션 쿠키 획득)
    login_url = f"{WEB_API_URL.rstrip('/')}/api/auth/login"
    login_payload = {
        "name": WEB_USERNAME,
        "password": WEB_PASSWORD
    }
    
    try:
        print(f"[-] 로그인 요청 전송: {login_url} (계정: {WEB_USERNAME})")
        login_res = session.post(login_url, json=login_payload, timeout=15)
        login_res.raise_for_status()
        
        login_data = login_res.json()
        if not login_data.get("success"):
            raise ValueError(login_data.get("error", "로그인 응답 오류"))
            
        print("[OK] 웹 대시보드 로그인 성공 (세션 쿠키 확보).")
    except Exception as login_err:
        print(f"[치명적 오류] 웹 API 로그인 실패로 업로드를 계속할 수 없습니다: {login_err}")
        raise login_err
        
    # 10-2. 가공된 엑셀 파일들을 API를 통해 순차적 업로드 및 자동 동기화
    try:
        upload_url = f"{WEB_API_URL.rstrip('/')}/api/upload/excel"
        for local_file_path in local_upload_files:
            file_name = os.path.basename(local_file_path)
            file_type = "business-info" if "business_info" in file_name else "measurement-business"
            
            print(f"[-] 파일 전송 중: {file_name} (타입: {file_type})")
            
            if not os.path.exists(local_file_path):
                raise FileNotFoundError(f"업로드 대상 파일이 경로에 존재하지 않습니다: {local_file_path}")
                
            with open(local_file_path, 'rb') as f:
                files = {
                    'file': (file_name, f, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                }
                data = {
                    'type': file_type,
                    'autoSync': 'true' # 업로드 즉시 백엔드에서 Supabase DB 동기화 및 검증 실행
                }
                
                print(f"[-] API 전송 및 DB 동기화 대기 중... (타입: {file_type})")
                upload_res = session.post(upload_url, files=files, data=data, timeout=180)
                upload_res.raise_for_status()
                
                res_data = upload_res.json()
                if res_data.get("success"):
                    print(f"[OK] 파일 업로드 및 Supabase 동기화 성공: {file_name}")
                    if res_data.get("syncMessage"):
                        print(f"    - 결과 메시지: {res_data.get('syncMessage')}")
                else:
                    error_msg = res_data.get("error", "알 수 없는 API 에러")
                    print(f"[오류] 파일 동기화 실패 ({file_name}): {error_msg}")
                    raise ValueError(f"웹 동기화 오류: {error_msg}")
                    
        print("[성공] 모든 통합 연동 자동화 프로세스가 완료되었습니다.")
        
    except Exception as upload_err:
        print(f"[치명적 오류] 웹 API 업로드/동기화 연동 단계 실패: {upload_err}")
        raise upload_err

if __name__ == "__main__":
    try:
        main()
    except Exception as global_err:
        print("\n" + "="*50)
        print("[치명적 에러] 프로그램 실행 중 예기치 못한 에러가 발생했습니다.")
        print(f"에러 메시지: {global_err}")
        print("="*50)
        
        # 상세 트레이스백 출력
        traceback.print_exc()
        
        # 파일에 로그 기록
        try:
            os.makedirs("C:\\Temp", exist_ok=True)
            log_path = "C:\\Temp\\mes_error.log"
            with open(log_path, "w", encoding="utf-8") as f:
                f.write(f"=== 에러 발생 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")
                f.write(f"에러 내용: {global_err}\n\n")
                traceback.print_exc(file=f)
            print(f"\n[OK] 상세 에러 로그가 다음 경로에 기록되었습니다: {log_path}")
        except Exception as log_write_err:
            print(f"[경고] 로그 파일 생성 실패: {log_write_err}")
            
        print("\n" + "="*50)
        input("프로그램이 비정상 종료되었습니다. 에러 내용을 확인한 뒤 엔터를 누르면 창이 닫힙니다...")
        sys.exit(1)