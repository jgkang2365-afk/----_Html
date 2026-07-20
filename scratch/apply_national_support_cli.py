# -*- coding: utf-8 -*-
"""
건강디딤돌 결과 조회 CLI 모듈
이 스크립트는 입력된 사업장관리번호, 사업개시번호, 대표자명을 사용하여 공단 결과 조회 페이지에서 결과를 조회하고 JSON으로 반환합니다.
"""

import os
import sys
import argparse
import time
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

def print_log(message):
    """표준 에러 출력으로 한글 로그를 즉시 내보냅니다. (표준 출력은 JSON만 내보내기 위함)"""
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write(f"[{timestamp}] {message}\n")
    sys.stderr.flush()

def classify_lookup_candidates(candidates):
    """정확한 연도·주기 행이 없을 때만 신규 신청 가능한 결과 없음으로 판정합니다."""
    exact_match_found = False
    for has_year, has_period, result_status in candidates:
        if not (has_year and has_period):
            continue
        exact_match_found = True
        if result_status:
            return result_status
    return "STANDBY" if exact_match_found else "NO_RESULT"


def main():
    parser = argparse.ArgumentParser(description="건강디딤돌 결과 조회 CLI 프로그램")
    parser.add_argument("--sanjae", required=True, help="사업장관리번호(산재관리번호)")
    parser.add_argument("--commencement", required=True, help="사업개시번호")
    parser.add_argument("--representative", required=True, help="대표자명")
    parser.add_argument("--contact_name", required=False, default="", help="담당자 성명 (조회시 미사용)")
    parser.add_argument("--contact_phone", required=False, default="", help="담당자 연락처 (조회시 미사용)")
    parser.add_argument("--period", default="상반기", help="반기 종류 (상반기/하반기)")
    parser.add_argument("--year", default="2026", help="신청년도")

    args = parser.parse_args()

    # 인자 정제
    import re
    sanjae = str(args.sanjae).replace("-", "").strip()
    commencement = str(args.commencement).replace("-", "").strip()
    
    # 대표자명 실시간 1인 정규화 (법적 원본은 DB에 있고, 조회 통신 시점에만 가공)
    raw_representative = str(args.representative).strip()
    if "," in raw_representative:
        raw_representative = raw_representative.split(",")[0].strip()
    representative = re.sub(r'외\s*\d*\s*(인|명|)', '', raw_representative).strip()
    
    period = str(args.period).strip()
    year = str(args.year).strip()


    print_log(f"결과 조회 기동 - 산재번호: {sanjae}, 개시번호: {commencement}, 대표자: {representative}, 년도: {year}, 반기: {period}")

    # 기본은 화면을 표시해 개발 서버 PC에서 실제 조회 상황을 확인합니다.
    # 무인 실행이 필요할 때만 NATIONAL_SUPPORT_HEADLESS=true로 설정합니다.
    chrome_options = Options()
    headless = os.getenv("NATIONAL_SUPPORT_HEADLESS", "false").strip().lower() in ("1", "true", "yes", "y")
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument("--disable-popup-blocking")
    chrome_options.add_argument("--disable-notifications")
    chrome_options.add_argument("--disable-background-networking")
    chrome_options.add_argument("--disable-background-timer-throttling")
    chrome_options.add_argument("--disable-renderer-backgrounding")
    chrome_options.add_argument("--disable-features=Translate,MediaRouter,OptimizationHints")
    chrome_options.add_argument("--remote-debugging-pipe")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--log-level=3")  # 불필요한 크롬 로그 최소화
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation", "enable-logging"])
    chrome_options.add_experimental_option("useAutomationExtension", False)
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    driver = None
    try:
        print_log(f"크롬 브라우저 초기화 중 ({'숨김' if headless else '화면 표시'} 모드)...")
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
        
        url = "https://portal.kosha.or.kr/business-apply-search/health-support/step-stone/cont/sub1"
        print_log(f"결과 조회 페이지 접속 시도: {url}")
        driver.get(url)
        
        # 입력 필드가 로드될 때까지 대기
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[1]/div/input'))
        )
        
        # 1. 사업장관리번호 입력
        print_log("사업장관리번호 입력 필드 작성")
        biz_id_field = driver.find_element(By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[1]/div/input')
        biz_id_field.clear()
        biz_id_field.send_keys(sanjae)
        time.sleep(0.5)

        # 2. 대표자명 입력
        print_log("대표자명 입력 필드 작성")
        ceo_field = driver.find_element(By.XPATH, '//*[@id="contents"]/article/div[1]/div/figure[3]/div/input')
        ceo_field.clear()
        ceo_field.send_keys(representative)
        time.sleep(0.5)

        # 3. 사업개시번호 입력
        print_log("사업개시번호 입력 필드 작성")
        try:
            business_start_field = driver.find_element(By.CSS_SELECTOR, '#contents > article > div.listSearch > div > figure:nth-child(4) > div > input[type=text]')
            business_start_field.clear()
            business_start_field.send_keys(commencement)
            time.sleep(0.5)
        except Exception as start_err:
            print_log(f"사업개시번호 입력 중 오류(무시): {str(start_err)}")

        # 4. 조회 버튼 클릭
        print_log("조회 버튼 클릭")
        search_button = driver.find_element(By.XPATH, '//*[@id="contents"]/article/div[1]/button')
        search_button.click()
        time.sleep(4) # 네트워크 딜레이 및 동시 요청 시 결과 갱신 지연 방지를 위해 대기 시간 연장

        # 5. 결과 대기 및 파싱
        print_log("결과 테이블 대기 및 파싱 중...")
        result = None
        try:
            WebDriverWait(driver, 8).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '#applicateGrid'))
            )
            
            table = driver.find_element(By.CSS_SELECTOR, '#applicateGrid')
            rows = table.find_elements(By.TAG_NAME, "tr")[1:]  # 헤더 제외
            
            # 결과 한글 문자열을 영문 상태 코드로 변환하는 헬퍼 함수
            def map_result_status(row_text):
                if not row_text:
                    return "STANDBY"
                if "대상" in row_text and "비대상" not in row_text:
                    return "SUPPORT"
                elif "비대상" in row_text:
                    return "NON_SUPPORT"
                return "STANDBY"

            def parse_row(cols):
                texts = [col.text.strip() for col in cols]
                row_text = " | ".join(texts)
                has_year = any(text == year for text in texts)
                has_period = any(text.strip() == period for text in texts)

                result_status = None
                for text in texts:
                    if "비대상" in text:
                        result_status = "NON_SUPPORT"
                        break
                    if text == "대상" or ("대상" in text and "비대상" not in text):
                        result_status = "SUPPORT"

                print_log(f"조회 기록 감지 - 행: {row_text}, 연도일치: {has_year}, 반기일치: {has_period}, 결과: {result_status or '미확인'}")
                return has_year, has_period, result_status

            # 요청한 연도와 반기가 모두 같은 결과만 인정합니다.
            # 다른 반기의 결과를 요청 반기로 저장하면 지원 여부가 잘못 확정됩니다.
            candidates = []
            for row in rows:
                cols = row.find_elements(By.TAG_NAME, "td")
                if len(cols) < 3:
                    continue

                has_year, has_period, result_status = parse_row(cols)
                candidates.append((has_year, has_period, result_status))

            result = classify_lookup_candidates(candidates)
            if result == "NO_RESULT":
                print_log("요청 연도와 반기가 모두 일치하는 신청 내역이 없습니다.")
            elif result == "STANDBY":
                print_log("요청 연도와 반기가 일치하는 내역은 있으나 결과가 미확정입니다.")
                            
        except Exception as table_err:
            print_log(f"테이블 파싱 오류 혹은 내역 미감지: {str(table_err)}")
            # "조회된 내역이 없습니다" 메시지가 있는지 검사
            try:
                no_data_msg = driver.find_element(By.XPATH, '//*[contains(text(), "조회된 내역이 없습니다")]')
                if no_data_msg:
                    result = "NO_RESULT"
            except:
                result = "FAIL"

        if result:
            print_log(f"최종 결과 확인: {result}")
            result_json = {"status": "SUCCESS", "result": result, "message": "결과 조회가 완료되었습니다."}
        else:
            print_log("결과를 특정할 수 없어 '대기' 상태로 반환합니다.")
            result_json = {"status": "SUCCESS", "result": "STANDBY", "message": "해당 조건의 신청 결과를 찾을 수 없습니다."}

        print(json.dumps(result_json, ensure_ascii=False))

    except Exception as err:
        print_log(f"결과 조회 중 치명적인 에러 발생: {str(err)}")
        result_json = {"status": "ERROR", "message": str(err)}
        sys.stdout.write(json.dumps(result_json, ensure_ascii=False) + "\n")
        sys.exit(1)
    finally:
        if driver:
            try:
                driver.quit()
                print_log("웹 드라이버 정상 종료")
            except:
                pass

if __name__ == '__main__':
    main()



