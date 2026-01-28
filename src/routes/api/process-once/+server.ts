/**
 * POST /api/process-once
 * 
 * 상품번호 기반 사업자등록번호 추출 API 엔드포인트
 * - multipart/form-data로 이미지와 대상 상품번호 수신
 * - OpenAI API로 해당 상품번호에 매핑된 모든 사업자등록번호 추출
 * - CSV 생성 및 이메일 발송
 * - 다중 결과 지원
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnvConfig } from '$lib/util/env';
import {
	extractBusinessRegNo,
	validateExtractionResult,
	normalizeProductCode,
	validateProductCode,
	type ExtractionError,
	type ExtractionItem
} from '$lib/extract/affiliateCode';
import { generateExcel, excelToBase64, generateExcelFilename, type ExcelDataItem } from '$lib/output/excel';
import { sendResultEmail } from '$lib/email/resend';
import { v4 as uuidv4 } from 'uuid';

// 페이로드 크기 제한 (4.5MB)
const MAX_PAYLOAD_SIZE = 4_500_000;

interface EmailDebugInfo {
	attempted: boolean;
	success: boolean;
	message_id?: string;
	error?: string;
	error_details?: {
		name?: string;
		message?: string;
		statusCode?: number;
	};
	sender_email?: string;
	recipient_email?: string;
}

// 응답에서 사용할 항목 타입
interface ResponseItem {
	product_code: string;
	business_reg_no: string;
	company_name?: string;
	row_index?: number;
}

interface SuccessResponse {
	ok: true;
	product_code: string;           // 검색한 상품번호
	items: ResponseItem[];          // 추출된 모든 항목
	total_found: number;            // 찾은 총 개수
	confidence: number;             // 신뢰도
	emailed: boolean;
	email_debug?: EmailDebugInfo;
	provider: 'openai' | 'mock';
	request_id: string;
	client_request_id?: string;
	x_request_id?: string;
}

interface ErrorResponse {
	ok: false;
	error_code: string;
	message: string;
	request_id: string;
	provider?: 'openai' | 'mock';
	client_request_id?: string;
	x_request_id?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	const requestId = uuidv4();
	console.log(`[API] Process request started, request_id: ${requestId}`);

	try {
		// 1. 환경변수 로드 및 검증
		const config = loadEnvConfig();
		console.log(`[API] Config loaded, model: ${config.OPENAI_MODEL}`);

		// 2. Content-Type 체크
		const contentType = request.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return json({
				ok: false,
				error_code: 'invalid_content_type',
				message: 'Content-Type must be multipart/form-data',
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		// 3. FormData 파싱
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return json({
				ok: false,
				error_code: 'invalid_form_data',
				message: 'Failed to parse form data',
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}


		// 4. 대상 상품번호 추출 (콤마로 구분된 다중 코드 지원)
		const targetCodeRaw = formData.get('productCode');
		if (!targetCodeRaw || typeof targetCodeRaw !== 'string') {
			return json({
				ok: false,
				error_code: 'missing_product_code',
				message: '대상 상품번호를 입력해주세요.',
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		// 공백 제거 및 정규화
		const productCodes = targetCodeRaw.split(',').map(code => normalizeProductCode(code)).filter(c => c.length > 0);
		console.log(`[API] Target product codes: ${productCodes.join(', ')}`);

		// 5. 대상 상품번호 형식 검증 (5자리 숫자) - 모든 코드가 유효해야 함
		const invalidCodes = productCodes.filter(code => !validateProductCode(code, config.PRODUCT_CODE_REGEX));

		if (productCodes.length === 0) {
			return json({
				ok: false,
				error_code: 'invalid_product_code',
				message: '유효한 상품번호가 없습니다.',
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		if (invalidCodes.length > 0) {
			return json({
				ok: false,
				error_code: 'invalid_product_code',
				message: `상품번호 형식이 올바르지 않습니다. 5자리 숫자를 입력해주세요. (잘못된 입력: ${invalidCodes.join(', ')})`,
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		// 6. 파일 추출
		const file = formData.get('image');
		if (!file || !(file instanceof File)) {
			return json({
				ok: false,
				error_code: 'missing_file',
				message: 'No image file provided. Field name must be "image".',
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		console.log(`[API] File received: ${file.name}, size: ${file.size}, type: ${file.type}`);

		// 7. 파일 크기 체크 (4.5MB 제한)
		if (file.size > MAX_PAYLOAD_SIZE) {
			return json({
				ok: false,
				error_code: 'payload_too_large',
				message: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds limit (4.5MB). Please compress the image before uploading.`,
				request_id: requestId
			} satisfies ErrorResponse, { status: 413 });
		}

		// 8. 이미지 타입 체크
		const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
		if (!allowedTypes.includes(file.type)) {
			return json({
				ok: false,
				error_code: 'invalid_file_type',
				message: `Invalid file type: ${file.type}. Allowed types: ${allowedTypes.join(', ')}`,
				request_id: requestId
			} satisfies ErrorResponse, { status: 400 });
		}

		// 9. 이미지를 Base64로 변환
		const arrayBuffer = await file.arrayBuffer();
		const imageBase64 = Buffer.from(arrayBuffer).toString('base64');
		console.log(`[API] Image converted to Base64, length: ${imageBase64.length}`);

		// 10. OpenAI API로 사업자등록번호 추출 (다중 결과 및 다중 타겟 코드)
		let extractionResult;
		try {
			// 배열 형태의 productCodes를 전달 (기존 함수 시그니처 변경 필요)
			// 임시로 join해서 넘기고 내부에서 처리하거나, 함수를 수정해야 함.
			// 여기서는 함수 수정 전이므로, 가장 포괄적인 검색을 위해 첫 번째 코드를 메인으로 사용하지 않고, 
			// extractBusinessRegNo 함수 자체를 수정하여 string[]을 받도록 변경 예정.
			// 현재는 string으로 전달하되, 콤마 구분자로 넘김
			extractionResult = await extractBusinessRegNo(imageBase64, file.type, productCodes.join(','), config);
			console.log(`[API] Extraction result:`, {
				total_found: extractionResult.total_found,
				items: extractionResult.items,
				confidence: extractionResult.confidence,
				provider: extractionResult.provider
			});
		} catch (e) {
			console.error('[API] Extraction error:', e);
			return json({
				ok: false,
				error_code: 'extraction_error',
				message: e instanceof Error ? e.message : 'Failed to extract business registration number from image',
				request_id: requestId
			} satisfies ErrorResponse, { status: 422 });
		}

		// 11. 추출 결과 검증 (사업자등록번호 존재 + 신뢰도)
		try {
			validateExtractionResult(extractionResult, config);
		} catch (e) {
			const err = e as ExtractionError;
			console.error('[API] Validation error:', err);
			return json({
				ok: false,
				error_code: err.error_code,
				message: err.message,
				request_id: requestId,
				provider: err.provider,
				client_request_id: err.client_request_id,
				x_request_id: err.x_request_id
			} satisfies ErrorResponse, { status: 422 });
		}

		console.log(`[API] Extracted ${extractionResult.total_found} items for product codes: ${productCodes.join(', ')}`);

		// 12. Excel 생성 (다중 항목)
		const processedAt = new Date().toISOString();
		const excelItems: ExcelDataItem[] = extractionResult.items.map((item: ExtractionItem) => ({
			product_code: item.product_code,
			business_reg_no: item.business_reg_no,
			company_name: item.company_name,
			row_index: item.row_index,
			processed_at: processedAt
		}));
		const excelBuffer = generateExcel(excelItems);
		const excelBase64 = excelToBase64(excelBuffer);
		const excelFilename = generateExcelFilename();
		console.log(`[API] Excel generated: ${excelFilename}, rows: ${excelItems.length}`);

		// 13. 이메일 발송
		let emailed = false;
		const emailDebug: EmailDebugInfo = {
			attempted: true,
			success: false,
			sender_email: config.SENDER_EMAIL,
			recipient_email: config.RECIPIENT_EMAIL
		};

		try {
			console.log('[API] Sending email...');
			console.log('[API] From:', config.SENDER_EMAIL);
			console.log('[API] To:', config.RECIPIENT_EMAIL);

			const emailResult = await sendResultEmail(
				productCodes.join(','), // 이메일 제목 등에 사용될 대표 코드
				extractionResult.items,
				excelBase64,
				excelFilename,
				config
			);

			emailed = emailResult.success;
			emailDebug.success = emailResult.success;
			emailDebug.message_id = emailResult.messageId;
			emailDebug.error = emailResult.error;

			if (!emailed) {
				console.error('[API] Email send failed:', emailResult.error);
				emailDebug.error_details = {
					message: emailResult.error
				};
			} else {
				console.log(`[API] Email sent to ${config.RECIPIENT_EMAIL}, messageId: ${emailResult.messageId}`);
			}
		} catch (e) {
			console.error('[API] Email exception:', e);
			emailed = false;
			emailDebug.success = false;
			emailDebug.error = e instanceof Error ? e.message : String(e);
			emailDebug.error_details = {
				name: e instanceof Error ? e.name : 'Unknown',
				message: e instanceof Error ? e.message : String(e)
			};
		}

		// 14. 성공 응답 (다중 결과)
		const responseItems: ResponseItem[] = extractionResult.items.map((item: ExtractionItem) => ({
			product_code: item.product_code,
			business_reg_no: item.business_reg_no,
			company_name: item.company_name,
			row_index: item.row_index
		}));

		const response: SuccessResponse = {
			ok: true,
			product_code: productCodes.join(','), // 응답에도 콤마로 구분해서 반환

			items: responseItems,
			total_found: extractionResult.total_found,
			confidence: extractionResult.confidence,
			emailed,
			email_debug: emailDebug,
			provider: extractionResult.provider,
			request_id: requestId,
			client_request_id: extractionResult.client_request_id,
			x_request_id: extractionResult.x_request_id
		};

		console.log(`[API] Process completed successfully, found ${response.total_found} items`);
		return json(response);

	} catch (e) {
		console.error('[API] Unexpected error:', e);

		// 환경변수 에러는 500
		if (e instanceof Error && e.message.includes('Missing required environment variables')) {
			return json({
				ok: false,
				error_code: 'configuration_error',
				message: 'Server configuration error. Please contact administrator.',
				request_id: requestId
			} satisfies ErrorResponse, { status: 500 });
		}

		return json({
			ok: false,
			error_code: 'internal_error',
			message: e instanceof Error ? e.message : 'An unexpected error occurred',
			request_id: requestId
		} satisfies ErrorResponse, { status: 500 });
	}
};
