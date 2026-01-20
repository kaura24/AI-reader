/**
 * 환경변수 검증 및 로딩 모듈
 * - 서버 사이드에서만 사용
 * - 누락된 필수 환경변수 체크 (즉시 종료 + 명확한 에러)
 * - 비밀값은 절대 로깅하지 않음
 */

import { env } from '$env/dynamic/private';

export interface EnvConfig {
	// 상품번호 설정
	PRODUCT_CODE_REGEX: RegExp;
	MIN_CONFIDENCE: number;

	// OpenAI 설정
	OPENAI_API_KEY: string;
	OPENAI_MODEL: string;
	OPENAI_ORGANIZATION_ID?: string;
	OPENAI_PROJECT_ID?: string;

	// Resend 설정
	RESEND_API_KEY: string;
	RECIPIENT_EMAIL: string;
	SENDER_EMAIL: string;

	// 개발용
	MOCK_LLM: boolean;
}

const REQUIRED_VARS = [
	'OPENAI_API_KEY',
	'RESEND_API_KEY'
] as const;

let cachedConfig: EnvConfig | null = null;

/**
 * 환경변수 검증 및 로딩
 * 누락된 필수 환경변수가 있으면 에러 발생 (즉시 종료)
 */
export function loadEnvConfig(): EnvConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	const missingVars: string[] = [];

	// MOCK_LLM이 true면 OPENAI_API_KEY는 필수가 아님
	const mockLlm = env.MOCK_LLM === 'true';

	// 필수 환경변수 체크
	for (const key of REQUIRED_VARS) {
		// MOCK 모드에서는 OPENAI_API_KEY 누락 무시
		if (mockLlm && key === 'OPENAI_API_KEY') {
			continue;
		}
		if (!env[key]) {
			missingVars.push(key);
		}
	}

	// 누락된 환경변수가 있으면 명확한 에러 메시지와 함께 종료
	if (missingVars.length > 0) {
		const errorMessage = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 필수 환경변수 누락 오류
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

다음 환경변수가 설정되지 않았습니다:
${missingVars.map(v => `  • ${v}`).join('\n')}

해결 방법:
1. 프로젝트 루트에 .env 파일을 생성하세요
2. 아래 형식으로 환경변수를 설정하세요:

   OPENAI_API_KEY=sk-your-api-key-here
   RESEND_API_KEY=re_your-api-key-here

3. 서버를 재시작하세요

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

		console.error(errorMessage);
		throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
	}

	// 상품번호 Regex 파싱 (기본값: 5자리 숫자)
	let productCodeRegex: RegExp;
	const regexStr = env.PRODUCT_CODE_REGEX || '^\\d{5}$';
	try {
		productCodeRegex = new RegExp(regexStr);
	} catch (e) {
		throw new Error(`Invalid PRODUCT_CODE_REGEX: "${regexStr}" - ${e}`);
	}

	// Confidence 파싱
	const minConfidence = parseFloat(env.MIN_CONFIDENCE || '0.6');
	if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
		throw new Error(
			`Invalid MIN_CONFIDENCE: "${env.MIN_CONFIDENCE}". Must be a number between 0 and 1.`
		);
	}

	cachedConfig = {
		PRODUCT_CODE_REGEX: productCodeRegex,
		MIN_CONFIDENCE: minConfidence,

		OPENAI_API_KEY: env.OPENAI_API_KEY || '',
		// 기본 모델: gpt-5-mini-2025-08-07 (코드에서 fallback 처리)
		OPENAI_MODEL: env.OPENAI_MODEL || 'gpt-5-mini-2025-08-07',
		OPENAI_ORGANIZATION_ID: env.OPENAI_ORGANIZATION_ID,
		OPENAI_PROJECT_ID: env.OPENAI_PROJECT_ID,

		RESEND_API_KEY: env.RESEND_API_KEY!,
		// 수신자 이메일 (Resend 테스트 계정은 계정 이메일로만 발송 가능)
		RECIPIENT_EMAIL: 'kaura24@gmail.com',
		// 발신자 이메일 (Resend 테스트용)
		SENDER_EMAIL: env.SENDER_EMAIL || 'Acme <onboarding@resend.dev>',

		MOCK_LLM: mockLlm
	};

	return cachedConfig;
}

/**
 * 환경변수 캐시 클리어 (테스트용)
 */
export function clearEnvCache(): void {
	cachedConfig = null;
}
