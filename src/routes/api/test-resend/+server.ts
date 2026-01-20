/**
 * GET /api/test-resend
 * 
 * Resend API 연결 테스트 엔드포인트
 * - API 키 유효성 확인
 * - 테스트 이메일 발송 (선택적)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnvConfig } from '$lib/util/env';
import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';

export const GET: RequestHandler = async ({ url }) => {
	const requestId = uuidv4();
	const sendTest = url.searchParams.get('send') === 'true';

	console.log(`[Resend Test] Started, request_id: ${requestId}, sendTest: ${sendTest}`);

	try {
		// 환경변수 로드
		const config = loadEnvConfig();

		if (!config.RESEND_API_KEY) {
			return json({
				ok: false,
				error_code: 'missing_api_key',
				message: 'RESEND_API_KEY가 설정되지 않았습니다.',
				request_id: requestId
			}, { status: 500 });
		}

		const resend = new Resend(config.RESEND_API_KEY);

		// API 키 유효성 검사 (도메인 목록 조회)
		console.log('[Resend Test] Checking API key validity...');
		
		try {
			const { data: domains, error: domainsError } = await resend.domains.list();
			
			if (domainsError) {
				console.error('[Resend Test] Domain list error:', domainsError);
				return json({
					ok: false,
					error_code: 'api_key_invalid',
					message: `API 키 검증 실패: ${domainsError.message}`,
					details: {
						error_name: domainsError.name,
						error_message: domainsError.message
					},
					request_id: requestId
				}, { status: 401 });
			}

			console.log('[Resend Test] Domains:', domains);

			// 테스트 이메일 발송 (선택적)
			let emailTestResult = null;
			if (sendTest) {
				console.log('[Resend Test] Sending test email...');
				console.log('[Resend Test] From:', config.SENDER_EMAIL);
				console.log('[Resend Test] To:', config.RECIPIENT_EMAIL);

				const { data: emailData, error: emailError } = await resend.emails.send({
					from: config.SENDER_EMAIL,
					to: config.RECIPIENT_EMAIL,
					subject: `[테스트] Resend API 연결 테스트 - ${new Date().toLocaleString('ko-KR')}`,
					html: `
						<div style="font-family: sans-serif; padding: 20px;">
							<h2>✅ Resend API 연결 테스트 성공</h2>
							<p>이 이메일은 API 연결 테스트를 위해 자동으로 발송되었습니다.</p>
							<hr>
							<p><strong>Request ID:</strong> ${requestId}</p>
							<p><strong>발송 시각:</strong> ${new Date().toISOString()}</p>
							<p><strong>발신자:</strong> ${config.SENDER_EMAIL}</p>
							<p><strong>수신자:</strong> ${config.RECIPIENT_EMAIL}</p>
						</div>
					`
				});

				if (emailError) {
					console.error('[Resend Test] Email error:', emailError);
					emailTestResult = {
						success: false,
						error: emailError.message,
						error_name: emailError.name
					};
				} else {
					console.log('[Resend Test] Email sent:', emailData);
					emailTestResult = {
						success: true,
						message_id: emailData?.id
					};
				}
			}

			return json({
				ok: true,
				message: 'Resend API 연결 성공!',
				config: {
					sender_email: config.SENDER_EMAIL,
					recipient_email: config.RECIPIENT_EMAIL,
					api_key_prefix: config.RESEND_API_KEY.substring(0, 8) + '...'
				},
				domains: domains?.data?.map((d: { name: string; status: string }) => ({
					name: d.name,
					status: d.status
				})) || [],
				email_test: emailTestResult,
				request_id: requestId
			});

		} catch (apiError) {
			console.error('[Resend Test] API call error:', apiError);
			return json({
				ok: false,
				error_code: 'api_error',
				message: `Resend API 호출 실패: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
				request_id: requestId
			}, { status: 500 });
		}

	} catch (e) {
		console.error('[Resend Test] Exception:', e);

		if (e instanceof Error && e.message.includes('Missing required environment variables')) {
			return json({
				ok: false,
				error_code: 'configuration_error',
				message: e.message,
				request_id: requestId
			}, { status: 500 });
		}

		return json({
			ok: false,
			error_code: 'internal_error',
			message: e instanceof Error ? e.message : '알 수 없는 오류',
			request_id: requestId
		}, { status: 500 });
	}
};

