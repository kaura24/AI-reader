/**
 * 상품번호 기반 사업자등록번호 추출 모듈
 * - 대상 상품번호를 기반으로 이미지에서 모든 매칭되는 사업자등록번호 추출
 * - LLM 프롬프트 정의
 * - Mock 모드 지원
 * - 다중 결과 지원
 */

import type { EnvConfig } from '$lib/util/env';
import { extractWithOpenAI, type OpenAIResponse, type ExtractedItem } from '$lib/llm/openai';
import { v4 as uuidv4 } from 'uuid';

// 개별 추출 항목
export interface ExtractionItem {
	product_code: string;           // 상품번호
	business_reg_no: string;        // 사업자등록번호
	company_name?: string;          // 업체명
	row_index?: number;             // 행 번호
	raw_text?: string;              // 원본 텍스트
}

// 전체 추출 결과
export interface ExtractionResult {
	items: ExtractionItem[];        // 추출된 모든 항목 배열
	total_found: number;            // 찾은 총 개수
	confidence: number;
	provider: 'openai' | 'mock';
	request_id: string;
	client_request_id?: string;
	x_request_id?: string;
}

export interface ExtractionError {
	error_code: string;
	message: string;
	provider?: 'openai' | 'mock';
	request_id?: string;
	client_request_id?: string;
	x_request_id?: string;
}

/**
 * 대상 상품번호 기반 사업자등록번호 및 업체명 추출 프롬프트 생성
 * 다중 결과를 위한 프롬프트
 */

function createExtractionPrompt(targetCode: string): string {
	const targets = targetCode.split(',').map(c => c.trim()).filter(Boolean);
	const targetCondition = targets.length > 1
		? `상품번호 리스트 [${targets.join(', ')}] 중 하나라도`
		: `상품번호 "${targets[0]}"`;

	return `당신은 이미지에서 특정 상품정보에 매핑된 사업자등록번호와 업체명을 추출하는 전문가입니다.

## 작업
이미지에서 ${targetCondition}가 포함된 **모든 행(row)**을 찾고, 각 행에 있는 사업자등록번호와 업체명을 추출하세요.

## 중요 규칙 (엄격 준수)
1. **대상 찾기**: 이미지 텍스트에서 **${targetCondition}**와 일치하는 숫자를 찾으세요.이 숫자는 "상품번호", "상품코드", "제휴코드", "Product Code", "Code", "NO", "P/N" 등 다양한 레이블과 함께 있거나, 레이블 없이 숫자만 있을 수 있습니다. 
2. **모든 행 추출**: 동일한 상품번호가 여러 행에 있을 수 있습니다. 조건에 맞는 모든 행을 빠짐없이 추출하세요. 소기업 상품조회 대상(03269, 03275)의 경우 둘 중 하나라도 발견되면 즉시 추출하세요.
3. **사업자등록번호**: "000-00-00000" (3-2-5자리) 형식 또는 하이픈 없는 10자리 숫자입니다. 사업자번호가 없으면 빈 문자열로 두세요.
4. **업체명**: 해당 행의 회사명, 상호, 법인명 등을 추출하세요.
5. **결과 없음**: 해당하는 상품번호를 전혀 찾을 수 없으면 items를 빈 배열로 반환하세요.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요:
{
  "items": [
    {
      "product_code": "찾은 상품번호 (예: ${targets[0]})",
      "business_reg_no": "000-00-00000",
      "company_name": "업체명",
      "row_index": 1,
      "raw_text": "해당 행의 원본 텍스트 전체"
    }
  ],
  "total_found": 1,
  "confidence": 0.0~1.0
}`;
}

/**
 * 상품번호 정규화 (공백, 하이픈 제거)
 */
export function normalizeProductCode(code: string): string {
	return code
		.trim()
		.replace(/\s+/g, '')      // 공백 제거
		.replace(/[-_]/g, '');     // 하이픈, 언더스코어 제거
}

/**
 * 상품번호 형식 검증
 */
export function validateProductCode(code: string, regex: RegExp): boolean {
	return regex.test(code);
}

/**
 * 사업자등록번호 정규화 (000-00-00000 형식으로)
 */
export function normalizeBusinessRegNo(businessRegNo: string): string {
	// 숫자만 추출
	const digits = businessRegNo.replace(/\D/g, '');

	// 10자리인 경우 000-00-00000 형식으로 변환
	if (digits.length === 10) {
		return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
	}

	// 이미 형식이 맞거나 다른 경우 그대로 반환
	return businessRegNo.trim();
}

/**
 * Mock 추출 결과 생성 (테스트용) - 다중 결과
 */
/* Mock 추출 결과 생성 (테스트용) - 다중 결과 */
function getMockResult(targetCode: string): ExtractionResult {
	// Mock 결과는 첫 번째 타겟 코드로 생성하거나, 단순히 요청된 코드를 반환
	const firstTarget = targetCode.split(',')[0].trim();
	return {
		items: [
			{
				product_code: firstTarget,
				business_reg_no: '123-45-67890',
				company_name: '테스트업체A',
				row_index: 1,
				raw_text: `[MOCK] 행1: 상품번호 ${firstTarget}, 사업자등록번호 123-45-67890, 업체명 테스트업체A`
			},
			{
				product_code: firstTarget,
				business_reg_no: '987-65-43210',
				company_name: '테스트업체B',
				row_index: 2,
				raw_text: `[MOCK] 행2: 상품번호 ${firstTarget}, 사업자등록번호 987-65-43210, 업체명 테스트업체B`
			}
		],
		total_found: 2,
		confidence: 0.95,
		provider: 'mock',
		request_id: uuidv4()
	};
}

/**
 * 이미지에서 대상 상품번호에 매핑된 모든 사업자등록번호 추출 (OpenAI API 사용)
 * 
 * @param imageBase64 - Base64 인코딩된 이미지
 * @param mimeType - 이미지 MIME 타입
 * @param targetCode - 찾고자 하는 대상 상품번호
 * @param config - 환경 설정
 */
export async function extractBusinessRegNo(
	imageBase64: string,
	mimeType: string,
	targetCode: string,
	config: EnvConfig
): Promise<ExtractionResult> {
	// Mock 모드
	if (config.MOCK_LLM) {
		console.log('[Extract] Using MOCK mode');
		return getMockResult(targetCode);
	}

	// 프롬프트 생성
	const prompt = createExtractionPrompt(targetCode);

	// OpenAI API 호출
	const response: OpenAIResponse = await extractWithOpenAI(
		imageBase64,
		mimeType,
		config,
		prompt
	);

	// 결과 변환
	const items: ExtractionItem[] = response.result.items.map((item: ExtractedItem) => ({
		product_code: item.product_code,
		business_reg_no: item.business_reg_no || '',
		company_name: item.company_name || '',
		row_index: item.row_index,
		raw_text: item.raw_text
	}));

	return {
		items,
		total_found: response.result.total_found,
		confidence: response.result.confidence,
		provider: 'openai',
		request_id: response.metadata.client_request_id,
		client_request_id: response.metadata.client_request_id,
		x_request_id: response.metadata.x_request_id
	};
}

/**
 * 추출 결과 검증 (다중 결과 지원)
 * 실패 시 ExtractionError를 throw
 */
export function validateExtractionResult(
	result: ExtractionResult,
	config: EnvConfig
): void {
	// 결과가 없는지 체크
	if (!result.items || result.items.length === 0) {
		const error: ExtractionError = {
			error_code: 'extraction_failed',
			message: `이미지에서 해당 상품번호에 매핑된 사업자등록번호를 찾을 수 없습니다.`,
			provider: result.provider,
			request_id: result.request_id,
			client_request_id: result.client_request_id,
			x_request_id: result.x_request_id
		};
		throw error;
	}

	// 신뢰도 체크
	if (result.confidence < config.MIN_CONFIDENCE) {
		const error: ExtractionError = {
			error_code: 'low_confidence',
			message: `사업자등록번호 인식 신뢰도가 너무 낮습니다. (${(result.confidence * 100).toFixed(1)}% < ${(config.MIN_CONFIDENCE * 100).toFixed(1)}%)`,
			provider: result.provider,
			request_id: result.request_id,
			client_request_id: result.client_request_id,
			x_request_id: result.x_request_id
		};
		throw error;
	}

	// 각 항목의 사업자등록번호 정규화
	for (const item of result.items) {
		if (item.business_reg_no) {
			item.business_reg_no = normalizeBusinessRegNo(item.business_reg_no);
		}
	}
}
