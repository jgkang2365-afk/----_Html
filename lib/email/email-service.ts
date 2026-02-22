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

const DEFAULT_CONFIG: EmailConfig = {
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.NAVER_EMAIL_ID || '', // 환경변수에서 관리
        pass: process.env.NAVER_EMAIL_PASSWORD || '', // 환경변수에서 관리
    },
};

export class EmailService {
    private transporter: nodemailer.Transporter;

    constructor(config: EmailConfig = DEFAULT_CONFIG) {
        this.transporter = nodemailer.createTransport(config);
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
          <p>안녕하십니까!</p>
          <p>${year}년 ${semester} 작업환경측정결과 보고서 첨부와 같이 송부드리며, 서면은 우편으로 발송 예정이오니 참고하시기 바랍니다.</p>
          <p>감사합니다.</p>
          <br>
          <hr style="border: none; border-top: 1px solid #cccccc;">
          <p style="font-size: 12px; color: #666666;">
            본 메일 계정은 주식회사 한결작업환경컨설팅의 작업환경측정결과 보고서 발송 전용 계정으로 수신이 불가능합니다.<br>
            회신이나 문의가 필요할 경우 <a href="mailto:${DEFAULT_CONFIG.auth.user}@naver.com" style="color: #0066cc; font-weight: bold; text-decoration: none;">${DEFAULT_CONFIG.auth.user}@naver.com</a>을 이용해 주시기 바랍니다.
          </p>
        </body>
      </html>
    `;

        try {
            const info = await this.transporter.sendMail({
                from: `"한결작업환경컨설팅" <${DEFAULT_CONFIG.auth.user}@naver.com>`,
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
