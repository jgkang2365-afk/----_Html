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
        year: string;
        semester: string;
        attachments: { filename: string; path: string }[];
    }) {
        const { to, companyName, year, semester, attachments } = options;

        // 수신자 이메일 파싱 (콤마 분리 지원)
        const toList = to.split(/[,;]/).map(email => email.trim()).filter(Boolean);

        if (toList.length === 0) {
            throw new Error('수신자 이메일 주소가 올바르지 않습니다.');
        }

        const subject = `${companyName}-${year}년 ${semester} 작업환경측정결과 보고서 송부`;
        const html = `
      <html>
        <body style="font-family: '맑은 고딕', Malgun Gothic, sans-serif; font-size: 14px; line-height: 1.6;">
          <p style="margin: 0;">안녕하십니까!</p>
          <br>
          <p style="margin: 0;">${year}년 ${semester} 작업환경측정결과 보고서 첨부와 같이 송부드리며, 서면은 우편으로 발송 예정이오니 참고하시기 바랍니다.</p>
          <br><br>
          <p style="margin: 0;">감사합니다.</p>
          <br><br><br>
          <div style="border-top: 3px solid #add8e6; border-bottom: 3px solid #add8e6; padding: 10px 0;">
            <p style="font-size: 12px; color: #666666; margin: 0;">
              본 메일 계정은 주식회사 한결작업환경컨설팅의 작업환경측정결과 보고서 발송 전용 계정으로 수신이 불가능한 계정입니다.<br>
              회신이나 문의가 필요할 경우 <a href="mailto:5678882@naver.com" style="color: #0066cc; font-weight: bold; text-decoration: none;">5678882@naver.com</a> 또는 <span style="color: #0066cc; font-weight: bold;">041-567-8882</span>로 연락 주시면 성실하게 답변드리도록 하겠습니다.
            </p>
          </div>
        </body>
      </html>
    `;

        try {
            const info = await this.transporter.sendMail({
                from: `"한결작업환경컨설팅" <${this.config.auth.user}>`,
                to: toList,
                subject,
                html,
                attachments: attachments.map(att => ({
                    filename: att.filename,
                    path: att.path,
                    contentType: 'application/pdf',
                })),
            });

            console.log(`[Email Success] ${companyName}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error(`[Email Error] ${companyName}:`, error);
            throw error;
        }
    }
}
