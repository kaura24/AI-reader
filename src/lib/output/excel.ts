/**
 * Excel 출력 모듈
 * - 인메모리 XLSX 생성
 * - 한글 헤더 지원
 * - 열 너비 자동 조정
 * - Base64 인코딩 (이메일 첨부용)
 * - 다중 결과 지원
 */

import * as XLSX from 'xlsx';

export interface ExcelDataItem {
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
 * Excel 데이터 생성 (다중 행 지원)
 * @param items 상품번호, 사업자등록번호, 업체명, 처리시각 배열
 * @returns ArrayBuffer 형태의 XLSX 데이터
 */
export function generateExcel(items: ExcelDataItem[]): ArrayBuffer {
	// 데이터 배열 생성
	const data = items.map((item, index) => ({
		'순번': index + 1,
		'상품번호': item.product_code,  // 문자열로 저장
		'업체명': item.company_name || '',
		'사업자등록번호': item.business_reg_no,
		'사업자번호(숫자만)': extractDigitsOnly(item.business_reg_no),
		'처리시각(ISO8601)': item.processed_at
	}));

	// 워크시트 생성
	const worksheet = XLSX.utils.json_to_sheet(data);

	// 열 너비 설정 (문자 수 기준)
	worksheet['!cols'] = [
		{ wch: 8 },   // 순번
		{ wch: 12 },  // 상품번호
		{ wch: 25 },  // 업체명
		{ wch: 18 },  // 사업자등록번호
		{ wch: 18 },  // 사업자번호(숫자만)
		{ wch: 28 }   // 처리시각
	];

	// 상품번호 열을 텍스트로 강제 설정 (앞자리 0 보존)
	const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
	for (let row = range.s.r + 1; row <= range.e.r; row++) {
		const cellAddress = XLSX.utils.encode_cell({ r: row, c: 1 }); // B열 (상품번호)
		const cell = worksheet[cellAddress];
		if (cell) {
			cell.t = 's'; // 텍스트 타입으로 설정
			cell.z = '@'; // 텍스트 포맷
		}
	}

	// 워크북 생성
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, worksheet, '조회결과');

	// ArrayBuffer로 출력
	const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
	return buffer;
}

/**
 * Excel을 Base64로 인코딩
 * @param buffer ArrayBuffer
 * @returns Base64 인코딩된 문자열
 */
export function excelToBase64(buffer: ArrayBuffer): string {
	// Node.js 환경
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(buffer).toString('base64');
	}

	// 브라우저 환경 (fallback)
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * 타임스탬프 기반 파일명 생성
 * @returns product_result_YYYYMMDD_HHMMSS.xlsx 형식
 */
export function generateExcelFilename(): string {
	const now = new Date();
	const timestamp = now.toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '_')
		.replace(/\.\d+Z$/, '');
	return `product_result_${timestamp}.xlsx`;
}

