import { Builder, By, Key, until, WebDriver, WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * K2B 시스템 자동화 서비스
 * 파이썬 스크립트(작업환경측정결과 보고서 처리.py)의 connect_to_k2b 로직을 1:1 이식
 * 
 * 핵심 포인트:
 * - Nexacro 기반 K2B 사이트는 일반 input[type=file]이 아닌 OS 파일 대화상자를 사용
 * - 파이썬의 pyperclip + pyautogui 로직을 PowerShell SendKeys로 대체
 * - 모든 sleep 시간은 원본 파이썬 스크립트와 동일하게 유지
 */
export class K2BService {
    private driver: WebDriver | null = null;

    /**
     * 크롬 드라이버 초기화
     * 파이썬: options.add_argument("--start-maximized")
     *         options.add_experimental_option("detach", True)
     */
    async init() {
        // Next.js 환경에서 selenium-manager.exe 경로 설정
        const managerPath = process.env.SE_MANAGER_PATH || path.resolve(process.cwd(), 'node_modules', 'selenium-webdriver', 'bin', 'windows', 'selenium-manager.exe');
        if (fs.existsSync(managerPath)) {
            process.env.SE_MANAGER_PATH = managerPath;
            console.log(`[K2B] Selenium Manager Path: ${managerPath}`);
        }

        const options = new chrome.Options();
        
        // 서버 구동 환경 대응: 화면 크기 및 headless 설정
        const isHeadless = process.env.K2B_HEADLESS === 'true';
        if (isHeadless) {
            console.log('[K2B] 헤드리스 모드(Headless)로 브라우저를 구동합니다.');
            options.addArguments('--headless=new');
        } else {
            options.addArguments('--start-maximized');
        }

        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu'); // 서버 환경에서 그래픽 가속 비활성화
        
        // detach 옵션: 스크립트 종료 후에도 브라우저 유지 (헤드리스가 아닐 때만 유의미)
        options.excludeSwitches('enable-automation');

        console.log('[K2B] 크롬 드라이버 빌드를 시작합니다...');
        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        if (!isHeadless) {
            // 한번 더 최대화 호출 (안전장치)
            await this.driver.manage().window().maximize();
        }
        console.log('[K2B] 크롬 드라이버 초기화 완료.');
    }

    /**
     * K2B 로그인 및 파일전송(신) 메뉴 진입
     * 
     * 파이썬 원본 흐름:
     * 1. k2b_url 접속 → sleep(2)
     * 2. 로그인 화면 팝업 닫기 (2개) → 각각 sleep(1)
     * 3. sleep(2) (로그인 페이지 이동 대기)
     * 4. ID 입력 → PW 입력 → 로그인 버튼 클릭
     * 5. title_contains("K2B") 대기 (20초)
     * 6. 내부 팝업 닫기 → sleep(1)
     * 7. '파일전송(신)' 클릭 → sleep(3)
     */
    async login(id?: string, pw?: string) {
        if (!this.driver) throw new Error('Driver not initialized');

        // Step 0: K2B 접속
        console.log('[K2B] 사이트 접속 중: https://k2b.kosha.or.kr/index.do');
        await this.driver.get('https://k2b.kosha.or.kr/index.do');
        await this.driver.sleep(2000); // time.sleep(2)

        // Step 1: 로그인 화면 팝업 닫기 (2개)
        const popupSelectors = [
            'div#mainframe_VFrameSet_LoginFrame_form_div_popup_361_btn_close',
            'div#mainframe_VFrameSet_LoginFrame_form_div_popup_360_btn_close'
        ];
        for (const selector of popupSelectors) {
            try {
                const btn = await this.driver.wait(
                    until.elementLocated(By.css(selector)), 5000
                );
                await btn.click();
                await this.driver.sleep(1000); // time.sleep(1)
            } catch (e) {
                // 팝업이 없으면 무시 (except TimeoutException: pass)
            }
        }

        // 로그인 페이지 이동 대기
        await this.driver.sleep(2000); // time.sleep(2)

        // Step 2: 로그인 정보 입력
        const loginId = id || process.env.K2B_ID;
        const loginPw = pw || process.env.K2B_PW;

        if (!loginId || !loginPw) {
            throw new Error('K2B ID 또는 PW가 제공되지 않았습니다.');
        }

        // ID 입력 (WebDriverWait 20초)
        const idInput = await this.driver.wait(
            until.elementLocated(By.css('#mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_edt_mber_ID_input')),
            20000
        );
        await idInput.sendKeys(loginId);

        // PW 입력 (WebDriverWait 20초)
        const pwInput = await this.driver.wait(
            until.elementLocated(By.xpath("//*[@id='mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_edt_password_input']")),
            20000
        );
        await pwInput.click();
        await pwInput.sendKeys(loginPw);

        // 로그인 버튼 클릭 (WebDriverWait 20초)
        const loginBtn = await this.driver.wait(
            until.elementLocated(By.css('#mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_btn_loginTextBoxElement > div')),
            20000
        );
        console.log(`[K2B] 로그인 시도 중... (ID: ${loginId})`);
        await loginBtn.click();

        // 로그인 성공 확인 (WebDriverWait 20초)
        await this.driver.wait(until.titleContains('K2B'), 20000);

        // 내부 화면 팝업 닫기 (1개)
        try {
            const innerPopupBtn = await this.driver.wait(
                until.elementLocated(By.css('div#mainframe_VFrameSet_MainFrame_form_div_popup_363_btn_closeTextBoxElement > div')),
                3000
            );
            await innerPopupBtn.click();
            await this.driver.sleep(1000); // time.sleep(1)
        } catch (e) {
            // 팝업이 없으면 무시
        }

        // '파일전송(신)' 버튼 클릭 (WebDriverWait 5초)
        console.log("[K2B] 로그인 성공. '파일전송(신)' 메뉴로 이동합니다.");
        const fileTransferBtn = await this.driver.wait(
            until.elementLocated(By.xpath("//div[text()='파일전송(신)']")),
            5000
        );
        await fileTransferBtn.click();
        await this.driver.sleep(3000); // time.sleep(3)
    }

    /**
     * 클립보드에 텍스트를 복사하고 Ctrl+V → Enter 전송
     * 파이썬의 pyperclip.copy() + pyautogui.hotkey('ctrl', 'v') + pyautogui.press('enter') 대체
     */
    private sendFilePathViaClipboard(filePath: string) {
        // PowerShell로 클립보드에 복사
        execSync(`powershell -command "Set-Clipboard -Value '${filePath.replace(/'/g, "''")}'"`);
        // Ctrl+V 붙여넣기 후 Enter
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`);
    }

    /**
     * 도면 파일 다중 선택 (파이썬의 pyautogui 로직 이식)
     * 
     * 파이썬 원본:
     * 1. pyautogui.hotkey('alt', 'd') → 주소창 이동
     * 2. pyperclip.copy(drawing_folder) → 폴더 경로 복사
     * 3. pyautogui.hotkey('ctrl', 'v') → 붙여넣기
     * 4. pyautogui.press('enter') → 폴더 이동
     * 5. time.sleep(1.5) → 폴더 이동 대기
     * 6. pyautogui.hotkey('alt', 'n') → 파일명 입력란 이동
     * 7. 파일명들을 큰따옴표+공백으로 연결하여 붙여넣기
     * 8. pyautogui.press('enter')
     */
    /**
     * PowerShell EncodedCommand를 사용하여 특수문자/따옴표 포함 텍스트를 클립보드에 안전하게 설정
     */
    private setClipboard(text: string) {
        // .NET 메서드를 사용하는 PowerShell 명령 생성
        const command = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText(([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}'))))`;
        // PowerShell에 명령 전달
        execSync(`powershell -command "${command}"`);
    }

    private sendMultipleFilesViaDialog(drawingFolder: string, jpgFiles: string[]) {
        // 1. Alt+D → 주소창 이동
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%d')"`);
        execSync(`powershell -command "Start-Sleep -Milliseconds 1000"`);

        // 2-4. 폴더 경로를 클립보드에 복사 후 붙여넣기 → Enter
        this.setClipboard(drawingFolder);
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 500; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`);
        execSync(`powershell -command "Start-Sleep -Milliseconds 2500"`); // 폴더 이동 대기

        // 5. Alt+N → 파일명 입력란 이동
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%n')"`);
        execSync(`powershell -command "Start-Sleep -Milliseconds 1000"`);

        // 6. 모든 파일명을 큰따옴표로 묶고 공백으로 연결
        const filenamesStr = jpgFiles.map(f => `"${f}"`).join(' ');
        
        // 클립보드에 파일명 넣기 (Encoded 방식으로 따옴표 완벽 보존)
        this.setClipboard(filenamesStr);

        // 7. Ctrl+V → 붙여넣기 후 Enter
        execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 2000; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`);
    }

    /**
     * 단일 업체 보고서 업로드 실행
     * 
     * 파이썬 원본 흐름 (각 업체별):
     * 1. 팝업 확인 → 닫기 시도
     * 2. target_folder 존재 확인 및 txt 파일 탐색
     * 3. 'XML 추가' 클릭 → sleep(1) → pyperclip/pyautogui로 파일 선택 → sleep(3)
     * 4. '위치도 업로드' 클릭 → sleep(3) → 도면 폴더 확인
     *    - 도면 폴더 존재 & JPG 있음 → pyautogui로 다중 파일 선택 → sleep(3)
     *      → '적용' 클릭 → sleep(2) → 'XML 업로드' 클릭 → sleep(3)
     *      → 확인 팝업 클릭 → sleep(3) → 동일 파일/업로드 완료 분기 처리
     *    - 도면 폴더 없음 or JPG 없음 → XML 삭제 → 다음 업체
     */
    async uploadReport(
        companyName: string,
        files: {
            dataFile: { path: string; filename: string } | null;
            drawings: { path: string; filename: string }[];
            drawingFolderPath?: string;
        }
    ): Promise<{ success: boolean; status: string; message?: string; error?: string }> {
        if (!this.driver) throw new Error('Driver not initialized');
        if (!files.dataFile) {
            return { success: false, status: 'txt 파일 없음', error: 'TXT 데이터 파일이 없습니다.' };
        }

        try {
            console.log(`[K2B] ${companyName} 업로드 시작`);

            // 각 업체 처리 전 팝업 닫기 시도
            try {
                const popupBtn = await this.driver.wait(
                    until.elementLocated(By.css('div.popup_close_button')), 3000
                );
                await popupBtn.click();
            } catch (e) {
                // 팝업 없으면 무시 (except TimeoutException: pass)
            }

            // ===== Step 1: 'XML 추가' 버튼 클릭 =====
            const addXmlBtn = await this.driver.wait(
                until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_AddTextBoxElement"]/div')),
                20000 // WebDriverWait 20초 (파이썬 동일)
            );
            await addXmlBtn.click();
            await this.driver.sleep(1000); // time.sleep(1) - 파일 선택 창 열림 대기

            // ===== Step 2: TXT 파일 경로를 클립보드로 전송 =====
            // 파이썬: pyperclip.copy(file_path) → time.sleep(1) → ctrl+v → time.sleep(1) → enter → sleep(3)
            this.sendFilePathViaClipboard(files.dataFile.path);
            await this.driver.sleep(3000); // time.sleep(3) - 파일 업로드 대기

            // ===== Step 3: '위치도 업로드' 버튼 클릭 =====
            try {
                const locationMapBtn = await this.driver.wait(
                    until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_grid_upload_body_gridrow_0_cell_0_2gridCellContainerElement')),
                    20000 // WebDriverWait 20초
                );
                await locationMapBtn.click();
                await this.driver.sleep(3000); // time.sleep(3)
            } catch (e) {
                // TimeoutException → continue (다음 업체)
                return { success: false, status: '위치도 버튼 오류', error: '위치도 업로드 버튼을 찾을 수 없습니다.' };
            }

            // ===== Step 4: 도면 폴더 확인 및 JPG 업로드 =====
            const drawingFolderPath = files.drawingFolderPath || '';
            const hasDrawingFolder = drawingFolderPath && fs.existsSync(drawingFolderPath);

            if (hasDrawingFolder) {
                const validExtensions = ['.jpg', '.jpeg', '.png'];
                const jpgFiles = files.drawings
                    .map(d => d.filename)
                    .filter(f => validExtensions.some(ext => f.toLowerCase().endsWith(ext)))
                    .sort(); // 파이썬: jpg_files.sort()

                if (jpgFiles.length > 0) {
                    console.log(`[K2B] ${companyName}: JPG 파일 ${jpgFiles.length}개 발견`);

                    // 다중 파일 선택 (pyautogui 로직 대체)
                    this.sendMultipleFilesViaDialog(drawingFolderPath, jpgFiles);
                    console.log(`[K2B] ${companyName}: 파일명 입력 완료`);
                    await this.driver.sleep(3000); // time.sleep(3) - 파일 업로드 완료 대기

                    // '적용' 버튼 클릭
                    try {
                        const applyBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_DHW00211P01_form_div_Btn_btn_Save"]/div[2]')),
                            20000
                        );
                        await applyBtn.click();
                        await this.driver.sleep(2000); // time.sleep(2)
                    } catch (e) {
                        return { success: false, status: '적용 버튼 오류', error: '적용 버튼을 찾을 수 없습니다.' };
                    }

                    // 'XML 업로드' 버튼 클릭
                    try {
                        const uploadBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_UploadTextBoxElement"]/div')),
                            20000
                        );
                        await uploadBtn.click();
                        await this.driver.sleep(3000); // time.sleep(3) - 업로드 완료 대기
                    } catch (e) {
                        return { success: false, status: 'XML 업로드 오류', error: 'XML 업로드 버튼을 찾을 수 없습니다.' };
                    }

                    // XML 등록 확인 팝업 클릭
                    try {
                        const confirmBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//div[contains(@id, "btn_confirmTextBoxElement")]/div')),
                            20000
                        );
                        await confirmBtn.click();
                        await this.driver.sleep(3000); // time.sleep(3) - 팝업 처리 대기
                    } catch (e) {
                        return { success: false, status: '확인 팝업 오류', error: '업로드 확인 팝업을 찾을 수 없습니다.' };
                    }

                    // ===== Step 5: 동일 파일 / 업로드 완료 분기 처리 =====
                    return await this.handleUploadResult(companyName);

                } else {
                    // JPG 파일이 없는 경우 → XML 삭제 진행
                    console.log(`[K2B] ${companyName}: JPG 파일 없음`);
                    await this.deleteXml();
                    return { success: false, status: 'JPG 파일 없음' };
                }
            } else {
                // 도면 폴더가 없는 경우 → XML 삭제 진행
                console.log(`[K2B] ${companyName}: 도면 폴더 없음`);
                await this.deleteXml();
                return { success: false, status: '도면 폴더 없음' };
            }

        } catch (error: any) {
            console.error(`[K2B Error] ${companyName}:`, error.message);
            return { success: false, status: '자동화 오류', error: error.message };
        }
    }

    /**
     * XML 등록 확인 팝업 후 분기 처리
     * 
     * 파이썬 원본:
     * 1. '동일한' 텍스트 포함 메시지 확인 (5초) → 확인 → XML 삭제 → "동일 파일 삭제 완료"
     * 2. '업로드' 텍스트 포함 메시지 확인 (5초) → 확인 → "업로드 완료"
     * 3. 둘 다 없으면 → "예상된 메시지 없음"
     */
    private async handleUploadResult(companyName: string): Promise<{ success: boolean; status: string; message?: string }> {
        if (!this.driver) throw new Error('Driver not initialized');

        // Case 1: '동일한' 메시지 확인
        try {
            const duplicateMsg = await this.driver.wait(
                until.elementLocated(By.xpath("//*[contains(@id, '동일한 파일이 존재합니다') and contains(@id, 'form_tea_message_textarea')]")),
                5000
            );
            const msgText = await duplicateMsg.getText();
            console.log(`[K2B] '동일한' 메시지 발견: ${msgText}`);

            // 확인 버튼 클릭
            const confirmBtn = await this.driver.wait(
                until.elementLocated(By.xpath('//div[text()="확인"]')), 10000
            );
            await confirmBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)

            // XML 삭제
            await this.deleteXml();
            return { success: false, status: '동일 파일 삭제 완료' };

        } catch (e) {
            // Case 2: '업로드' 메시지 확인
            try {
                const uploadMsg = await this.driver.wait(
                    until.elementLocated(By.xpath("//*[contains(text(), '업로드')]")),
                    5000
                );
                const msgText = await uploadMsg.getText();
                console.log(`[K2B] '업로드' 메시지 발견: ${msgText}`);

                // '정상 접수처리 안내' 팝업 확인
                const successBtn = await this.driver.wait(
                    until.elementLocated(By.xpath('//div[text()="확인"]')), 10000
                );
                await successBtn.click();
                await this.driver.sleep(2000); // time.sleep(2)

                return { success: true, status: '업로드 완료' };

            } catch (e2) {
                return { success: false, status: '예상된 메시지 없음' };
            }
        }
    }

    /**
     * XML 삭제 프로세스
     * 
     * 파이썬 원본:
     * 1. XML 삭제 버튼 클릭 → time.sleep(2)
     * 2. 삭제 확인 팝업의 확인 버튼 클릭 → time.sleep(2)
     */
    private async deleteXml() {
        if (!this.driver) return;

        try {
            // XML 삭제 버튼 클릭
            const deleteBtn = await this.driver.wait(
                until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_DelTextBoxElement > div')),
                10000
            );
            await deleteBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)

            // 삭제 확인 팝업의 확인 버튼 클릭
            const deleteConfirmBtn = await this.driver.wait(
                until.elementLocated(By.xpath('//div[text()="확인"]')),
                10000
            );
            await deleteConfirmBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)
        } catch (e) {
            console.warn('[K2B] XML 삭제 중 오류:', (e as Error).message);
        }
    }

    /**
     * 파일 접수 현황 결과 추출
     * 
     * 파이썬 원본:
     * 1. time.sleep(10) → 데이터 처리 시간 확보
     * 2. 조회 버튼 클릭 → time.sleep(3)
     * 3. 그리드에서 사업장명(cell_X_1)과 처리상태(cell_X_2)를 반복 추출
     */
    async extractResults(): Promise<{ companyName: string; status: string }[]> {
        if (!this.driver) return [];

        const results: { companyName: string; status: string }[] = [];

        try {
            // 10초 대기 (데이터 처리 시간 확보)
            console.log('[K2B] 데이터 처리를 위해 10초 대기 후 조회합니다...');
            await this.driver.sleep(10000); // time.sleep(10)

            // 조회 버튼 클릭
            try {
                const searchBtn = await this.driver.wait(
                    until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_btn_SearchTextBoxElement > div')),
                    10000
                );
                await searchBtn.click();
                console.log('[K2B] 접수 현황을 갱신했습니다.');
                await this.driver.sleep(3000); // time.sleep(3) - 조회 결과 로딩 대기
            } catch (e) {
                console.warn('[K2B] 조회 버튼 클릭 실패');
            }

            // 그리드에서 결과 추출
            try {
                await this.driver.wait(
                    until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_bodyGridBandContainerElement')),
                    10000
                );

                let rowIndex = 0;
                while (true) {
                    try {
                        // 사업장명 (cell_X_1)
                        const companySelector = `#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_1GridCellTextContainerElement > div`;
                        const companyEl = await this.driver.wait(
                            until.elementLocated(By.css(companySelector)), 2000
                        );

                        // 처리상태 (cell_X_2)
                        const statusSelector = `#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_2GridCellTextContainerElement > div`;
                        const statusEl = await this.driver.wait(
                            until.elementLocated(By.css(statusSelector)), 2000
                        );

                        const companyName = (await companyEl.getText()).trim();
                        const status = (await statusEl.getText()).trim();

                        if (companyName && companyName !== '알 수 없음') {
                            results.push({ companyName, status });
                            console.log(`[K2B] 사업장명: ${companyName} | 처리상태: ${status}`);
                        }

                        rowIndex++;
                    } catch (e) {
                        // 더 이상 행이 없으면 종료
                        break;
                    }
                }
            } catch (e) {
                console.warn('[K2B] 그리드 컨테이너를 찾을 수 없습니다.');
            }

        } catch (e) {
            console.error('[K2B] 결과 추출 실패:', (e as Error).message);
        }

        return results;
    }

    /**
     * 브라우저 종료 (파이썬은 오류 시에만 종료, 정상 완료 시 유지)
     */
    async quit() {
        if (this.driver) {
            await this.driver.quit();
            this.driver = null;
        }
    }
}
