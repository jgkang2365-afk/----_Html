# -*- coding: utf-8 -*-
"""건강디딤돌 업체 단위 조회·신청 통합 CLI.

업체 한 건마다 WebDriver를 한 번만 생성하고, 같은 Chrome 세션에서 조회 후
명확한 미신청 상태(NO_RESULT)일 때만 신청을 이어서 처리합니다.
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager


LOOKUP_URL = (
    "https://portal.kosha.or.kr/business-apply-search/"
    "health-support/step-stone/cont/sub1"
)
APPLICATION_URL = (
    "https://portal.kosha.or.kr/business-apply-search/"
    "health-support/step-stone/info"
)
profile_dir = None


def print_log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write(f"[{timestamp}] {message}\n")
    sys.stderr.flush()


def normalize_representative(value):
    representative = str(value or "").strip().split(",", 1)[0].strip()
    return re.sub(r"외\s*\d*\s*(인|명|)", "", representative).strip()


def classify_lookup_candidates(candidates):
    exact_match_found = False
    for has_year, has_period, result_status in candidates:
        if not (has_year and has_period):
            continue
        exact_match_found = True
        if result_status:
            return result_status
    return "STANDBY" if exact_match_found else "NO_RESULT"


def create_driver():
    global profile_dir
    options = Options()
    headless = os.getenv("NATIONAL_SUPPORT_HEADLESS", "false").strip().lower() in (
        "1", "true", "yes", "y",
    )
    if headless:
        options.add_argument("--headless=new")
    profile_dir = tempfile.mkdtemp(prefix="national-support-flow-")
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
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options,
    )


def cleanup_profile():
    global profile_dir
    if profile_dir:
        shutil.rmtree(profile_dir, ignore_errors=True)
        profile_dir = None


def lookup_with_driver(driver, sanjae, commencement, representative, year, period):
    sanjae = re.sub(r"\D", "", str(sanjae or ""))
    commencement = re.sub(r"\D", "", str(commencement or ""))
    representative = normalize_representative(representative)
    year = str(year or "").strip()
    period = str(period or "").strip()

    print_log(f"건강디딤돌 결과 조회 시작: 연도={year}, 주기={period}")
    driver.get(LOOKUP_URL)
    WebDriverWait(driver, 15).until(
        EC.presence_of_element_located(
            (By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[1]/div/input')
        )
    )

    business_field = driver.find_element(
        By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[1]/div/input'
    )
    business_field.clear()
    business_field.send_keys(sanjae)

    representative_field = driver.find_element(
        By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[3]/div/input'
    )
    representative_field.clear()
    representative_field.send_keys(representative)

    commencement_field = driver.find_element(
        By.CSS_SELECTOR,
        '#contents > article > div.listSearch > div > figure:nth-child(4) > div > input[type=text]',
    )
    commencement_field.clear()
    commencement_field.send_keys(commencement)

    driver.find_element(By.XPATH, '//*[@id="contents"]/article/div[1]/button').click()
    time.sleep(4)

    try:
        WebDriverWait(driver, 8).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "#applicateGrid"))
        )
        table = driver.find_element(By.CSS_SELECTOR, "#applicateGrid")
        candidates = []
        for row in table.find_elements(By.TAG_NAME, "tr")[1:]:
            columns = row.find_elements(By.TAG_NAME, "td")
            if len(columns) < 3:
                continue
            texts = [column.text.strip() for column in columns]
            has_year = any(text == year for text in texts)
            has_period = any(text == period for text in texts)
            result_status = None
            for text in texts:
                if "비대상" in text:
                    result_status = "NON_SUPPORT"
                    break
                if text == "대상" or ("대상" in text and "비대상" not in text):
                    result_status = "SUPPORT"
            candidates.append((has_year, has_period, result_status))
        result = classify_lookup_candidates(candidates)
    except Exception as error:
        body_text = driver.find_element(By.TAG_NAME, "body").text
        if "조회된 내역이 없습니다" in body_text:
            result = "NO_RESULT"
        else:
            print_log(f"조회 결과 판정 실패: {error}")
            result = "FAIL"

    print_log(f"건강디딤돌 결과 조회 판정: {result}")
    return result


def load_legacy_automation():
    script_path = Path(__file__).resolve().parent.parent / "건강디딤돌_접수_자동화.py"
    spec = importlib.util.spec_from_file_location("health_program_automation_flow", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("건강디딤돌 신청 자동화 모듈을 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.HealthProgramAutomation


def apply_with_driver(
    driver,
    sanjae,
    commencement,
    representative,
    contact_name,
    contact_phone,
    year,
    period,
):
    requested_year = str(year or "").strip()
    if requested_year != str(datetime.now().year):
        return "YEAR_CHECK_REQUIRED"
    if not str(contact_name or "").strip():
        raise ValueError("자동 신청 담당자명이 없습니다.")
    phone_digits = re.sub(r"\D", "", str(contact_phone or ""))
    if not re.fullmatch(r"010\d{7,8}", phone_digits):
        raise ValueError("자동 신청 담당자 휴대전화는 010 번호여야 합니다.")

    automation_class = load_legacy_automation()
    automation = automation_class.__new__(automation_class)
    automation.driver = driver
    automation.update_progress = print_log
    driver.get(APPLICATION_URL)
    legacy_result = automation._process_application(
        0,
        re.sub(r"\D", "", str(sanjae or "")),
        re.sub(r"\D", "", str(commencement or "")),
        normalize_representative(representative),
        "",
        str(contact_name).strip(),
        str(contact_phone).strip(),
        APPLICATION_URL,
        str(period or "").strip(),
        requested_year,
    )
    return {
        "OK": "APPLIED",
        "OVER_50": "OVER_50",
        "NO_INFO": "NO_EMPLOYEE_INFO",
        "EMPLOYEE_CHECK_FAILED": "EMPLOYEE_CHECK_FAILED",
        "YEAR_CHECK_REQUIRED": "YEAR_CHECK_REQUIRED",
        "APPLY_RESULT_UNKNOWN": "APPLY_RESULT_UNKNOWN",
        "ALREADY_APPLIED": "ALREADY_APPLIED",
    }.get(legacy_result, "FAIL")


def execute_flow(
    sanjae,
    commencement,
    representative,
    contact_name,
    contact_phone,
    year,
    period,
):
    driver = None
    try:
        driver = create_driver()

        lookup_result = lookup_with_driver(
            driver,
            sanjae,
            commencement,
            representative,
            year,
            period,
        )

        if lookup_result == "NO_RESULT":
            application_result = apply_with_driver(
                driver,
                sanjae,
                commencement,
                representative,
                contact_name,
                contact_phone,
                year,
                period,
            )
            return {
                "status": "SUCCESS",
                "result": application_result,
                "stage": "application",
                "lookup_result": lookup_result,
            }

        return {
            "status": "SUCCESS",
            "result": lookup_result,
            "stage": "lookup",
        }
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        cleanup_profile()


def main():
    parser = argparse.ArgumentParser(description="건강디딤돌 업체 단위 조회·신청 통합 자동화")
    parser.add_argument("--sanjae", required=True)
    parser.add_argument("--commencement", required=True)
    parser.add_argument("--representative", required=True)
    parser.add_argument("--contact_name", required=True)
    parser.add_argument("--contact_phone", required=True)
    parser.add_argument("--period", required=True)
    parser.add_argument("--year", required=True)
    args = parser.parse_args()

    try:
        result = execute_flow(
            args.sanjae,
            args.commencement,
            args.representative,
            args.contact_name,
            args.contact_phone,
            args.year,
            args.period,
        )
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print_log(f"건강디딤돌 통합 자동화 오류: {error}")
        print(json.dumps({"status": "ERROR", "message": str(error)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
