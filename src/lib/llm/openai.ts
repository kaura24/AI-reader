/**
 * OpenAI SDK 기반 Responses API 연동 모듈
 * - 공식 OpenAI Node SDK 사용
 * - gpt-5-mini-2025-08-07 기본, gpt-5-mini fallback
 * - X-Client-Request-Id 트레이싱
 * - 지수 백오프 재시도
 * - 다중 결과 지원 (동일 상품번호의 모든 행 추출)
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type { EnvConfig } from '$lib/util/env';

// 개별 추출 항목
export interface ExtractedItem {
	product_code: string;
	business_reg_no: string;
	company_name?: string;  // 업체명
	row_index?: number;     // 이미지에서의 행 번호 (선택)
	raw_text?: string;      // 해당 행의 원본 텍스트
}

// 전체 추출 결과
export interface OpenAIExtractionResult {
	items: ExtractedItem[];      // 추출된 모든 항목 배열
	total_found: number;         // 찾은 총 개수
	confidence: number;          // 전체 신뢰도
	raw_text?: string;           // 전체 원본 텍스트 (선택)
}

export interface OpenAICallMetadata {
	client_request_id: string;
	x_request_id?: string;
	model_used: string;
}

export interface OpenAIResponse {
	result: OpenAIExtractionResult;
	metadata: OpenAICallMetadata;
}

// 기본 모델 및 fallback 모델
const PRIMARY_MODEL = 'gpt-5-mini-2025-08-07';
const FALLBACK_MODEL = 'gpt-5-mini';
const LEGACY_FALLBACK = 'gpt-4o-mini';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

// OpenAI 클라이언트 캐시
let openaiClient: OpenAI | null = null;
let availableModel: string | null = null;

/**
 * OpenAI 클라이언트 초기화 및 반환
 */
function getOpenAIClient(apiKey: string): OpenAI {
	if (!openaiClient) {
		openaiClient = new OpenAI({
			apiKey: apiKey
		});
	}
	return openaiClient;
}

/**
 * 지수 백오프 딜레이 계산
 */
function getBackoffDelay(attempt: number): number {
	return INITIAL_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
}

/**
 * 사용 가능한 모델 확인 및 선택
 * - gpt-5-mini-2025-08-07 우선
 * - 없으면 gpt-5-mini fallback
 * - 그것도 없으면 gpt-4o-mini fallback
 */
async function getAvailableModel(client: OpenAI, configuredModel?: string): Promise<string> {
	// 이미 확인된 모델이 있으면 반환
	if (availableModel) {
		return availableModel;
	}

	// 환경변수로 지정된 모델이 있으면 먼저 시도
	if (configuredModel && configuredModel !== PRIMARY_MODEL) {
		availableModel = configuredModel;
		console.log(`[OpenAI] Using configured model: ${availableModel}`);
		return availableModel;
	}

	try {
		console.log('[OpenAI] Checking available models...');
		const models = await client.models.list();
		const modelIds = models.data.map(m => m.id);

		// 우선순위대로 모델 확인
		const modelPriority = [PRIMARY_MODEL, FALLBACK_MODEL, LEGACY_FALLBACK];
		
		for (const model of modelPriority) {
			if (modelIds.includes(model)) {
				availableModel = model;
				console.log(`[OpenAI] Selected model: ${availableModel}`);
				return availableModel;
			}
		}

		// 모든 권장 모델이 없으면 gpt-4o-mini 사용 (대부분 존재)
		availableModel = LEGACY_FALLBACK;
		console.log(`[OpenAI] Fallback to legacy model: ${availableModel}`);
		return availableModel;

	} catch (error) {
		// 모델 목록 조회 실패 시 기본값 사용
		console.warn('[OpenAI] Failed to list models, using default:', error);
		availableModel = LEGACY_FALLBACK;
		return availableModel;
	}
}

/**
 * 재시도 가능한 에러인지 확인
 */
function isRetryableError(error: unknown): boolean {
	if (error instanceof OpenAI.APIError) {
		// 429 (Rate Limit) 또는 5xx 에러
		return error.status === 429 || (error.status >= 500 && error.status < 600);
	}
	// 네트워크 에러
	if (error instanceof Error && error.message.includes('fetch')) {
		return true;
	}
	return false;
}

/**
 * 모델 관련 에러인지 확인 (fallback 필요)
 */
function isModelNotFoundError(error: unknown): boolean {
	if (error instanceof OpenAI.APIError) {
		// 404 또는 모델 관련 에러 메시지
		if (error.status === 404) return true;
		if (error.message?.includes('model') && error.message?.includes('not found')) return true;
		if (error.message?.includes('does not exist')) return true;
	}
	return false;
}

/**
 * OpenAI Responses API를 사용하여 이미지에서 정보 추출
 */
export async function extractWithOpenAI(
	imageBase64: string,
	mimeType: string,
	config: EnvConfig,
	systemPrompt: string
): Promise<OpenAIResponse> {
	if (!config.OPENAI_API_KEY) {
		throw new Error('OPENAI_API_KEY is not configured. Please set it in .env file.');
	}

	const client = getOpenAIClient(config.OPENAI_API_KEY);
	const clientRequestId = uuidv4();
	
	// 사용할 모델 결정
	let modelToUse = await getAvailableModel(client, config.OPENAI_MODEL);
	
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			console.log(
				`[OpenAI] Attempt ${attempt + 1}/${MAX_RETRIES}, model: ${modelToUse}, client_request_id: ${clientRequestId}`
			);

			// Responses API 호출 (OpenAI SDK의 responses.create 사용)
			const response = await client.responses.create({
				model: modelToUse,
				input: [
					{
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: systemPrompt
							},
							{
								type: 'input_image',
								image_url: `data:${mimeType};base64,${imageBase64}`
							}
						]
					}
				],
				text: {
					format: {
						type: 'json_object'
					}
				}
			}, {
				headers: {
					'X-Client-Request-Id': clientRequestId
				}
			});

			console.log('[OpenAI] Response received, model:', modelToUse);

			// 응답에서 텍스트 추출
			let outputText = '';
			if (response.output && Array.isArray(response.output)) {
				const messageOutput = response.output.find(
					(item: { type: string }) => item.type === 'message'
				);
				if (messageOutput?.content?.[0]?.text) {
					outputText = messageOutput.content[0].text;
				}
			}

			if (!outputText) {
				throw new Error('No text output in response');
			}

			// JSON 파싱 (다중 결과)
			const result = parseExtractionResult(outputText);

			return {
				result,
				metadata: {
					client_request_id: clientRequestId,
					x_request_id: undefined, // SDK에서는 직접 접근 어려움
					model_used: modelToUse
				}
			};

		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.error(`[OpenAI] Attempt ${attempt + 1} failed:`, lastError.message);

			// 모델이 없는 경우 fallback
			if (isModelNotFoundError(error) && modelToUse !== LEGACY_FALLBACK) {
				console.log(`[OpenAI] Model ${modelToUse} not found, trying fallback...`);
				
				if (modelToUse === PRIMARY_MODEL) {
					modelToUse = FALLBACK_MODEL;
				} else {
					modelToUse = LEGACY_FALLBACK;
				}
				availableModel = modelToUse;
				continue;
			}

			// 재시도 가능한 에러인 경우
			if (isRetryableError(error) && attempt < MAX_RETRIES - 1) {
				const delay = getBackoffDelay(attempt);
				console.log(`[OpenAI] Retrying in ${Math.round(delay)}ms...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
				continue;
			}
		}
	}

	throw lastError || new Error('OpenAI extraction failed after retries');
}

/**
 * LLM 응답에서 JSON 추출 및 파싱 (다중 결과 지원)
 */
function parseExtractionResult(text: string): OpenAIExtractionResult {
	let jsonStr = text.trim();

	// ```json ... ``` 형식 처리
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}

	// { } 블록만 추출
	const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
	if (braceMatch) {
		jsonStr = braceMatch[0];
	}

	try {
		const parsed = JSON.parse(jsonStr);

		// items 배열 확인
		if (!Array.isArray(parsed.items)) {
			throw new Error('Missing or invalid "items" array in response');
		}

		if (typeof parsed.confidence !== 'number') {
			throw new Error('Missing or invalid "confidence" field');
		}

		// 각 item 검증
		const items: ExtractedItem[] = parsed.items.map((item: Record<string, unknown>, index: number) => {
			if (typeof item.product_code !== 'string' || typeof item.business_reg_no !== 'string') {
				throw new Error(`Invalid item at index ${index}: missing product_code or business_reg_no`);
			}
			return {
				product_code: item.product_code,
				business_reg_no: item.business_reg_no,
				company_name: typeof item.company_name === 'string' ? item.company_name : undefined,
				row_index: typeof item.row_index === 'number' ? item.row_index : undefined,
				raw_text: typeof item.raw_text === 'string' ? item.raw_text : undefined
			};
		});

		return {
			items,
			total_found: parsed.total_found ?? items.length,
			confidence: parsed.confidence,
			raw_text: parsed.raw_text
		};
	} catch (e) {
		throw new Error(`Failed to parse JSON from LLM response: ${e}`);
	}
}

/**
 * OpenAI 연결 테스트 (models.list 사용)
 */
export async function testOpenAIConnection(config: EnvConfig): Promise<{
	ok: boolean;
	message: string;
	model?: string;
	modelCount?: number;
	error?: string;
}> {
	if (!config.OPENAI_API_KEY) {
		return {
			ok: false,
			message: 'OPENAI_API_KEY가 설정되지 않았습니다.',
			error: 'missing_api_key'
		};
	}

	try {
		const client = getOpenAIClient(config.OPENAI_API_KEY);
		const models = await client.models.list();
		
		const gptModels = models.data.filter(m => m.id.includes('gpt'));
		const selectedModel = await getAvailableModel(client, config.OPENAI_MODEL);

		return {
			ok: true,
			message: 'OpenAI API 연결 성공!',
			model: selectedModel,
			modelCount: gptModels.length
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			message: `OpenAI API 연결 실패: ${errorMessage}`,
			error: errorMessage
		};
	}
}

/**
 * 캐시 클리어 (테스트용)
 */
export function clearOpenAICache(): void {
	openaiClient = null;
	availableModel = null;
}
