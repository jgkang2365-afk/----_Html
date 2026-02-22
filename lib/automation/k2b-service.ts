import { Builder, By, Key, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import path from 'path';
import fs from 'fs';

/**
 * K2B 시스템 자동화 서비스
 */
export class K2BService {
    private driver: WebDriver | null = null;

    async init() {
        // Next.js 환경에서 selenium-manager.exe를 찾지 못하는 문제 해결을 위한 경로 설정
        const managerPath = path.resolve(process.cwd(), 'node_modules', 'selenium-webdriver', 'bin', 'windows', 'selenium-manager.exe');
        if (fs.existsSync(managerPath)) {
            process.env.SE_MANAGER_PATH = managerPath;
            console.log(`[K2B] Selenium Manager Path: ${managerPath}`);
        }

        const options = new chrome.Options();
        // ... (이후 로직 유지)
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        // 브라우저 창이 뜨지 않도록 하고 싶다면 아래 주석 해제 가능
        // options.addArguments('--headless'); 

        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
    }

    /**
     * K2B 로그인
     */
    async login(id?: string, pw?: string) {
        if (!this.driver) throw new Error('Driver not initialized');

        await this.driver.get('https://k2b.kosha.or.kr/login.do');

        // 매개변수가 없으면 환경 변수에서 로드 (하위 호환성)
        const loginId = id || process.env.K2B_ID;
        const loginPw = pw || process.env.K2B_PW;

        if (!loginId || !loginPw) {
            throw new Error('K2B ID 또는 PW가 제공되지 않았습니다. [내 정보 수정]에서 등록해주세요.');
        }

        await this.driver.findElement(By.id('id')).sendKeys(loginId);
        await this.driver.findElement(By.id('password')).sendKeys(loginPw, Key.RETURN);

        // 로그인 확인 대기
        await this.driver.wait(until.urlContains('main.do'), 10000);
    }

    /**
     * 보고서 업로드 실행 (단일 건)
     * 파이썬 로직을 참고하여 구현 필요
     */
    async uploadReport(companyName: string, filePath: string) {
        if (!this.driver) throw new Error('Driver not initialized');

        try {
            console.log(`[K2B] ${companyName} 업로드 시작: ${filePath}`);

            // 파일 존재 여부 확인
            if (!fs.existsSync(filePath)) {
                throw new Error(`파일이 존재하지 않습니다: ${filePath}`);
            }

            // Mock 동작을 위해 지연 시간 추가 (육안 확인을 위해 길게 설정)
            await new Promise(resolve => setTimeout(resolve, 6000));
            console.log(`[K2B] ${companyName} 업로드 폼 작성 완료`);

            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log(`[K2B] ${companyName} 파일 첨부 완료`);

            return { success: true, message: 'K2B 업로드 완료 (Mock)' };
        } catch (error: any) {
            console.error(`[K2B Error] ${companyName}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 브라우저 종료
     */
    async quit() {
        if (this.driver) {
            await this.driver.quit();
            this.driver = null;
        }
    }
}
