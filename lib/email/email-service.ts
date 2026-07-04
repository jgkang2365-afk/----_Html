import nodemailer from 'nodemailer';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * 이메일 발송 서비스
 * 네이버 SMTP를 사용하여 보고서와 수수료 내역서를 발송합니다.
 */
export interface EmailConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
}

const getEmailConfig = (): EmailConfig => ({
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.NAVER_EMAIL_ID || '', // 환경변수에서 관리
        pass: process.env.NAVER_EMAIL_PW || '', // 환경변수에서 관리
    },
});

export class EmailService {
    private transporter: nodemailer.Transporter;

    private config: EmailConfig;

    constructor(config?: EmailConfig) {
        this.config = config || getEmailConfig();
        this.transporter = nodemailer.createTransport(this.config);
    }

    /**
     * 보고서 메일 발송
     */
    async sendReportEmail(options: {
        to: string;
        companyName: string;
        reports: { year: string; period: string }[];
        attachments: { filename: string; path: string }[];
        isAdditional?: boolean; // 명시적으로 추가 요청 여부를 지정 (선택)
    }) {
        const { to, companyName, reports, attachments, isAdditional: manualIsAdditional } = options;

        // 수신자 이메일 파싱 (콤마 분리 지원)
        const toList = to.split(/[,;]/).map(email => email.trim()).filter(Boolean);

        if (toList.length === 0) {
            throw new Error('수신자 이메일 주소가 올바르지 않습니다.');
        }

        const primaryTo = toList[0];
        const ccList = toList.slice(1);

        // 판별 로직: 보고서가 1개 초과이거나 만료된 보고서(또는 명시적 추가 요청)인 경우
        // 여기서는 reports 배열의 길이를 기준으로 1차 판단하고, 호출부에서 넘겨준 manualIsAdditional 결합
        const isAdditional = manualIsAdditional || reports.length > 1;

        let subject = "";
        let bodyHtml = "";

        if (isAdditional) {
            // [추가 요청 / 합산 발송용 구성]
            subject = `${companyName} 요청하신 작업환경측정결과 보고서 송부`;
            bodyHtml = `
                <p style="margin: 0;">안녕하십니까!</p>
                <br>
                <p style="margin: 0;">요청하신 다음의 작업환경측정결과 보고서를 첨부와 같이 송부드립니다.</p>
                <br>
                <p style="margin: 0; font-weight: bold;">[보고서 목록]</p>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    ${reports.map(r => `<li>${r.year}년 ${r.period} 보고서</li>`).join('')}
                </ul>
            `;
        } else {
            // [정규 발송용 구성]
            const r = reports[0];
            subject = `${companyName}-${r.year}년 ${r.period} 작업환경측정결과 보고서 송부`;
            bodyHtml = `
                <p style="margin: 0;">안녕하십니까!</p>
                <br>
                <p style="margin: 0;">${r.year}년 ${r.period} 작업환경측정결과 보고서 첨부와 같이 송부드리며, 서면은 우편으로 발송 예정이오니 참고하시기 바랍니다.</p>
            `;
        }

        const html = `
      <html>
        <body style="font-family: '맑은 고딕', Malgun Gothic, sans-serif; font-size: 16px; line-height: 1.6;">
          ${bodyHtml}
          <br><br>
          <p style="margin: 0;">감사합니다.</p>
          <br><br><br>
          <div style="border-top: 3px solid #add8e6; border-bottom: 3px solid #add8e6; padding: 10px 0;">
            <p style="font-size: 13px; color: #666666; margin: 0;">
              본 메일 계정은 주식회사 한결작업환경컨설팅의 작업환경측정결과 보고서 발송 전용 계정으로 수신이 불가능한 계정입니다.<br>
              회신이나 문의가 필요할 경우 <a href="mailto:5678882@naver.com" style="color: #0066cc; font-weight: bold; text-decoration: none;">5678882@naver.com</a> 또는 <span style="color: #0066cc; font-weight: bold;">041-567-8882</span>로 연락 주시면 성실하게 답변드리도록 하겠습니다.
            </p>
          </div>
        </body>
      </html>
    `;

        try {
            const mailOptions: nodemailer.SendMailOptions = {
                from: `"한결작업환경컨설팅" <${this.config.auth.user}>`,
                to: primaryTo,
                subject,
                html,
                attachments: attachments.map(att => ({
                    filename: att.filename,
                    path: att.path,
                    contentType: 'application/pdf',
                })),
            };

            if (ccList.length > 0) {
                mailOptions.cc = ccList;
            }

            const info = await this.transporter.sendMail(mailOptions);

            console.log(`[Email Success] ${companyName}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error(`[Email Error] ${companyName}:`, error);
            throw error;
        }
    }

    /**
     * 시스템 오류 알림 메일 발송 (공단 사이트 개편 및 크롬 버전 불일치 대응)
     */
    async sendSystemAlertEmail(options: {
        subject: string;
        bodyHtml: string;
    }) {
        const adminEmail = process.env.ADMIN_EMAIL || '5678882@naver.com'; // 기본 수신 관리자 이메일
        try {
            const info = await this.transporter.sendMail({
                from: `"건강디딤돌 연동 시스템" <${this.config.auth.user}>`,
                to: adminEmail,
                subject: `[오류 알림] ${options.subject}`,
                html: `
                    <html>
                        <body style="font-family: '맑은 고딕', sans-serif; font-size: 15px; line-height: 1.6; color: #333;">
                            <h2 style="color: #d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">
                                건강디딤돌 자동 신청 시스템 에러 발생
                            </h2>
                            <p style="font-weight: bold; font-size: 16px;">
                                발생된 에러 요약: ${options.subject}
                            </p>
                            <div style="background-color: #f9f9f9; border: 1px solid #ddd; padding: 15px; border-radius: 4px; font-family: monospace;">
                                ${options.bodyHtml}
                            </div>
                            <br>
                            <p style="color: #666; font-size: 12px; margin-top: 20px;">
                                본 메일은 깡통 컴 개발 서버 자동화 모듈에 의해 자동 발송되었습니다. 사이트 정상 작동 여부를 긴급 점검해주시기 바랍니다.
                            </p>
                        </body>
                    </html>
                `,
            });

            console.log(`[Email Alert Success] ${options.subject}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error(`[Email Alert Error] ${options.subject}:`, error);
            throw error;
        }
    }
}

