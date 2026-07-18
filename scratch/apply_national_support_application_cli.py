# -*- coding: utf-8 -*-
"""기존 건강디딤돌 GUI 자동화의 단건 신청 로직을 호출하는 CLI."""

import argparse
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


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


def create_driver():
    options = Options()
    headless = os.getenv("NATIONAL_SUPPORT_HEADLESS", "false").strip().lower() in (
        "1", "true", "yes", "y",
    )
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-background-timer-throttling")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--disable-features=Translate,MediaRouter,OptimizationHints")
    options.add_argument("--remote-debugging-pipe")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--log-level=3")
    options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options,
    )


def main():
    parser = argparse.ArgumentParser(description="건강디딤돌 단건 자동 신청")
    parser.add_argument("--sanjae", required=True)
    parser.add_argument("--commencement", required=True)
    parser.add_argument("--representative", required=True)
    parser.add_argument("--contact_name", required=True)
    parser.add_argument("--contact_phone", required=True)
    parser.add_argument("--period", required=True)
    args = parser.parse_args()

    driver = None
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
        )
        mapped_result = {
            "OK": "APPLIED",
            "OVER_50": "OVER_50",
            "NO_INFO": "NO_EMPLOYEE_INFO",
        }.get(result, "FAIL")
        print(json.dumps({"status": "SUCCESS", "result": mapped_result}, ensure_ascii=False))
    except Exception as error:
        print_log(f"자동 신청 오류: {error}")
        print(json.dumps({"status": "ERROR", "message": str(error)}, ensure_ascii=False))
        sys.exit(1)
