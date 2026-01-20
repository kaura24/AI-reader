/**
 * GET /api/test-connection
 * 
 * OpenAI API 연결 테스트 엔드포인트
 * - OpenAI SDK의 models.list() 사용
 * - 사용 가능한 모델 확인
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnvConfig } from '$lib/util/env';
import { testOpenAIConnection } from '$lib/llm/openai';
import { v4 as uuidv4 } from 'uuid';

export const GET: RequestHandler = async () => {
	const requestId = uuidv4();
	console.log(`[Test] Connection test started, request_id: ${requestId}`);

	try {
		// 환경변수 로드
		const config = loadEnvConfig();

		// OpenAI 연결 테스트
		const result = await testOpenAIConnection(config);

		if (result.ok) {
			console.log(`[Test] Connection successful, model: ${result.model}`);
			return json({
				ok: true,
				message: result.message,
				configured_model: result.model,
				model_count: result.modelCount,
				request_id: requestId
			});
		} else {
			console.error(`[Test] Connection failed: ${result.error}`);
			return json({
				ok: false,
				error_code: 'connection_failed',
				message: result.message,
				request_id: requestId
			}, { status: 500 });
		}

	} catch (e) {
		console.error('[Test] Exception:', e);

		// 환경변수 에러
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
			error_code: 'connection_error',
			message: e instanceof Error ? e.message : '연결 실패',
			request_id: requestId
		}, { status: 500 });
	}
};
