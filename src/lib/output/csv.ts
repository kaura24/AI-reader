/**
 * CSV 출력 모듈
 * - 인메모리 CSV 생성
 * - 한글 헤더 지원
 * - Base64 인코딩 (이메일 첨부용)
 * - 다중 결과 지원
 */

export interface CsvDataItem {
	product_code: string;
	business_reg_no: string;
	company_name?: string;  // 업체명
	row_index?: number;
	processed_at: string; // ISO8601
}

/**
 * 사업자등록번호에서 숫자만 추출
 * @param businessRegNo 000-00-00000 형식의 사업자등록번호
 * @returns 0000000000 형식의 숫자만 있는 사업자번호
 */
function extractDigitsOnly(businessRegNo: string): string {
	return businessRegNo.replace(/\D/g, '');
}

/**
 * 상품번호를 문자열로 포맷 (앞자리 0 보존)
 * Excel에서 숫자로 변환되지 않도록 앞에 = 추가
 * @param productCode 상품번호
 * @returns 문자열로 포맷된 상품번호
 */
function formatProductCodeAsText(productCode: string): string {
	// ="00000" 형식으로 Excel에서 문자열로 인식하도록 처리
	return `="${productCode}"`;
}

/**
 * CSV 데이터 생성 (다중 행 지원)
 * @param items 상품번호, 사업자등록번호, 업체명, 처리시각 배열
 * @returns UTF-8 인코딩된 CSV 문자열
 */
export function generateCsv(items: CsvDataItem[]): string {
	// BOM + 헤더
	const BOM = '\uFEFF';
	const headers = ['순번', '상품번호', '업체명', '사업자등록번호', '사업자번호(숫자만)', '처리시각(ISO8601)'];

	// CSV 이스케이프 처리
	const escapeCsvValue = (value: string): string => {
		if (value.includes(',') || value.includes('"') || value.includes('\n')) {
			return `"${value.replace(/"/g, '""')}"`;
		}
		return value;
	};

	const headerLine = headers.map(escapeCsvValue).join(',');
	
	// 데이터 행 생성
	const dataLines = items.map((item, index) => {
		const row = [
			String(index + 1),
			formatProductCodeAsText(item.product_code),  // 문자열로 포맷 (앞자리 0 보존)
			item.company_name || '',                      // 업체명
			item.business_reg_no,
			extractDigitsOnly(item.business_reg_no),      // 숫자만 추출
			item.processed_at
		];
		return row.map(escapeCsvValue).join(',');
	});

	return BOM + headerLine + '\n' + dataLines.join('\n');
}

/**
 * CSV를 Base64로 인코딩
 * @param csv CSV 문자열
 * @returns Base64 인코딩된 문자열
 */
export function csvToBase64(csv: string): string {
	// Node.js 환경
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(csv, 'utf-8').toString('base64');
	}

	// 브라우저 환경 (fallback)
	const encoder = new TextEncoder();
	const bytes = encoder.encode(csv);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * 타임스탬프 기반 파일명 생성
 * @returns product_result_YYYYMMDD_HHMMSS.csv 형식
 */
export function generateCsvFilename(): string {
	const now = new Date();
	const timestamp = now.toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '_')
		.replace(/\.\d+Z$/, '');
	return `product_result_${timestamp}.csv`;
}
