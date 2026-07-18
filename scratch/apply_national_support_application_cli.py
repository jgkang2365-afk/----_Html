# -*- coding: utf-8 -*-
"""기존 건강디딤돌 GUI 자동화의 단건 신청 로직을 안전하게 호출하는 CLI."""

import argparse
import importlib.util
import json
import os
import shutil
import signal
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

driver = None
profile_dir = None


def print_log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write(f"[{timestamp}] {message}\n")
    sys.stderr.flush()


def load_legacy_automation():
    script_path = Path(__file__).resolve().parent.parent / "건강디딤돌_접수_자동화.py"
    spec = importlib.util.spec_from_file_location("health_program_automation", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("건강디딤돌 신청 자동화 모듈을 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.HealthProgramAutomation


def cleanup():
    global driver, profile_dir
    if driver:
        try:
            driver.quit()
        except Exception:
            pass
        driver = None
    if profile_dir:
        shutil.rmtree(profile_dir, ignore_errors=True)
        profile_dir = None


def handle_signal(signum, _frame):
    print_log(f"종료 신호 수신: {signum}")
    cleanup()
    raise SystemExit(128 + signum)


def create_driver():
    global profile_dir
    options = Options()
    headless = os.getenv("NATIONAL_SUPPORT_HEADLESS", "false").strip().lower() in (
        "1", "true", "yes", "y",
    )
    if headless:
        options.add_argument("--headless=new")
    profile_dir = tempfile.mkdtemp(prefix="national-support-chrome-")
    options.add_argument(f"--user-data-dir={profile_dir}")
    for argument in (
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-notifications",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
        "--remote-debugging-pipe",
        "--window-size=1920,1080",
        "--log-level=3",
    ):
        options.add_argument(argument)
    options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    options.add_experimental_option("useAutomationExtension", False)
    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options,
    )


def main():
    global driver
    parser = argparse.ArgumentParser(description="건강디딤돌 단건 자동 신청")
    parser.add_argument("--sanjae", required=True)
    parser.add_argument("--commencement", required=True)
    parser.add_argument("--representative", required=True)
    parser.add_argument("--contact_name", required=True)
    parser.add_argument("--contact_phone", required=True)
    parser.add_argument("--period", required=True)
    parser.add_argument("--year", required=True)
    args = parser.parse_args()

    requested_year = str(args.year).strip()
    if requested_year != str(datetime.now().year):
        print(json.dumps({
            "status": "SUCCESS",
            "result": "YEAR_CHECK_REQUIRED",
            "message": "현재 연도 이외의 신청은 자동 처리하지 않습니다.",
        }, ensure_ascii=False))
        return

    try:
        driver = create_driver()
        automation_class = load_legacy_automation()
        automation = automation_class.__new__(automation_class)
        automation.driver = driver
        automation.update_progress = print_log
        application_url = (
            "https://portal.kosha.or.kr/business-apply-search/"
            "health-support/step-stone/info"
        )
        driver.get(application_url)
        result = automation._process_application(
            0,
            str(args.sanjae).replace("-", "").strip(),
            str(args.commencement).replace("-", "").strip(),
            str(args.representative).strip(),
            "",
            str(args.contact_name).strip(),
            str(args.contact_phone).strip(),
            application_url,
            str(args.period).strip(),
            requested_year,
        )
        mapped_result = {
            "OK": "APPLIED",
            "OVER_50": "OVER_50",
            "NO_INFO": "NO_EMPLOYEE_INFO",
            "EMPLOYEE_CHECK_FAILED": "EMPLOYEE_CHECK_FAILED",
            "YEAR_CHECK_REQUIRED": "YEAR_CHECK_REQUIRED",
            "APPLY_RESULT_UNKNOWN": "APPLY_RESULT_UNKNOWN",
            "ALREADY_APPLIED": "ALREADY_APPLIED",
        }.get(result, "FAIL")
        print(json.dumps({"status": "SUCCESS", "result": mapped_result}, ensure_ascii=False))
    except Exception as error:
        print_log(f"자동 신청 오류: {error}")
        print(json.dumps({"status": "ERROR", "message": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
    finally:
        cleanup()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    main()
