/**
 * Resend 이메일 발송 모듈
 * - Excel 파일 Base64 첨부
 * - 고정 수신자
 * - 다중 결과 지원
 */

import { Resend } from 'resend';
import type { EnvConfig } from '$lib/util/env';

export interface EmailAttachment {
	filename: string;
	content: string; // Base64 encoded
}

export interface SendEmailOptions {
	subject: string;
	body: string;
	attachment: EmailAttachment;
}

export interface SendEmailResult {
	success: boolean;
	messageId?: string;
	error?: string;
}

// 추출 결과 항목 타입
export interface ResultItem {
	product_code: string;
	business_reg_no: string;
	company_name?: string;
	row_index?: number;
}

/**
 * CSV 첨부 이메일 발송
 */
export async function sendEmailWithAttachment(
	options: SendEmailOptions,
	config: EnvConfig
): Promise<SendEmailResult> {
	const resend = new Resend(config.RESEND_API_KEY);

	try {
		console.log('[Resend] Sending email to:', config.RECIPIENT_EMAIL);
		console.log('[Resend] From:', config.SENDER_EMAIL);
		console.log('[Resend] Subject:', options.subject);
		console.log('[Resend] Attachment:', options.attachment.filename);

		const { data, error } = await resend.emails.send({
			from: config.SENDER_EMAIL,
			to: config.RECIPIENT_EMAIL,
			subject: options.subject,
			html: options.body,
			attachments: [
				{
					filename: options.attachment.filename,
					content: options.attachment.content
				}
			]
		});

		if (error) {
			console.error('[Resend] Error:', error);
			return {
				success: false,
				error: error.message
			};
		}

		console.log('[Resend] Email sent successfully, ID:', data?.id);
		return {
			success: true,
			messageId: data?.id
		};
	} catch (e) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error('[Resend] Exception:', errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * 상품번호 조회 결과 이메일 발송 (다중 결과 지원)
 */
export async function sendResultEmail(
	productCode: string,
	items: ResultItem[],
	excelBase64: string,
	excelFilename: string,
	config: EnvConfig
): Promise<SendEmailResult> {
	const totalFound = items.length;
	const subject = `[사업자등록번호 조회 완료] 상품번호 ${productCode} (${totalFound}건)`;

	// 결과 항목 HTML 생성
	const itemsHtml = items.map((item, index) => `
		<tr style="background: ${index % 2 === 0 ? '#f8fafc' : 'white'};">
			<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${index + 1}</td>
			<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${item.product_code}</td>
			<td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${item.company_name || '-'}</td>
			<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: bold; color: #059669;">${item.business_reg_no}</td>
		</tr>
	`).join('');

	const body = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		body { font-family: 'Malgun Gothic', sans-serif; line-height: 1.6; color: #333; }
		.container { max-width: 700px; margin: 0 auto; padding: 20px; }
		.header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
		.content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
		.summary { margin: 15px 0; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #6366f1; }
		.summary-label { font-weight: bold; color: #64748b; }
		.summary-value { color: #1e293b; font-size: 1.2em; font-family: monospace; }
		.badge { display: inline-block; padding: 4px 12px; background: #6366f1; color: white; border-radius: 20px; font-size: 0.9em; margin-left: 8px; }
		table { width: 100%; border-collapse: collapse; margin-top: 15px; }
		th { background: #334155; color: white; padding: 12px 10px; text-align: left; }
		.footer { margin-top: 20px; font-size: 0.85em; color: #94a3b8; text-align: center; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h2 style="margin: 0;">✅ 사업자등록번호 조회 완료</h2>
			<p style="margin: 10px 0 0 0; opacity: 0.9;">상품번호 "${productCode}"에 대한 조회가 완료되었습니다.</p>
		</div>
		<div class="content">
			<div class="summary">
				<span class="summary-label">검색 상품번호:</span>
				<span class="summary-value">${productCode}</span>
				<span class="badge">${totalFound}건 발견</span>
			</div>
			
			<table>
				<thead>
					<tr>
						<th style="width: 50px; text-align: center;">순번</th>
						<th style="width: 100px;">상품번호</th>
						<th>업체명</th>
						<th style="width: 140px;">사업자등록번호</th>
					</tr>
				</thead>
				<tbody>
					${itemsHtml}
				</tbody>
			</table>

			<div style="margin-top: 15px; padding: 10px; background: white; border-radius: 4px;">
				<span class="summary-label">처리시각:</span>
				<span style="font-family: monospace;">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
			</div>
			
			<p style="margin-top: 15px; padding: 12px; background: #eff6ff; border-radius: 6px; border-left: 3px solid #3b82f6;">
				📎 상세 정보는 첨부된 Excel 파일을 확인해주세요.
			</p>
		</div>
		<div class="footer">
			이 메일은 상품번호 조회 시스템에서 자동으로 발송되었습니다.
		</div>
	</div>
</body>
</html>
	`.trim();

	return sendEmailWithAttachment(
		{
			subject,
			body,
			attachment: {
				filename: excelFilename,
				content: excelBase64
			}
		},
		config
	);
}
