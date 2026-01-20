/**
 * 클라이언트 사이드 이미지 리사이징/압축 모듈
 * - Vercel 4.5MB 제한을 위해 4.2MB 안전 마진 타겟
 * - Canvas API를 사용한 리사이징
 * - JPEG 품질 조정으로 압축
 * - 모바일 호환성 강화 (파일을 즉시 메모리에 복사)
 */

export interface ShrinkResult {
	blob: Blob;
	originalSize: number;
	finalSize: number;
	originalWidth: number;
	originalHeight: number;
	finalWidth: number;
	finalHeight: number;
	quality: number;
	scale: number;
	mimeType: string;
}

export interface ShrinkOptions {
	maxSizeBytes?: number;
	maxDimension?: number;
	initialQuality?: number;
	minQuality?: number;
	qualityStep?: number;
	scaleStep?: number;
	minScale?: number;
	timeout?: number;
}

// 디버깅 로그 저장
export interface ImageLoadLog {
	timestamp: string;
	method: string;
	success: boolean;
	duration: number;
	error?: string;
	fileInfo: {
		name: string;
		size: number;
		type: string;
	};
}

let loadLogs: ImageLoadLog[] = [];

export function getLoadLogs(): ImageLoadLog[] {
	return [...loadLogs];
}

export function clearLoadLogs(): void {
	loadLogs = [];
}

function addLog(log: Omit<ImageLoadLog, 'timestamp'>): void {
	loadLogs.push({
		...log,
		timestamp: new Date().toISOString()
	});
	// 최대 20개만 유지
	if (loadLogs.length > 20) {
		loadLogs = loadLogs.slice(-20);
	}
	console.log(`[ImageLoad] ${log.method}: ${log.success ? '성공' : '실패'} (${log.duration}ms)`, log.error || '');
}

const DEFAULT_OPTIONS: Required<ShrinkOptions> = {
	maxSizeBytes: 4.2 * 1024 * 1024, // 4.2MB 안전 마진
	maxDimension: 4096,               // 최대 가로/세로 픽셀
	initialQuality: 0.92,             // 초기 JPEG 품질
	minQuality: 0.5,                  // 최소 품질
	qualityStep: 0.05,                // 품질 감소 스텝
	scaleStep: 0.1,                   // 스케일 감소 스텝
	minScale: 0.3,                    // 최소 스케일
	timeout: 60000                    // 60초 타임아웃 (모바일용 증가)
};

/**
 * 파일을 즉시 ArrayBuffer로 읽기 (모바일에서 파일 참조 무효화 방지)
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				resolve(reader.result);
			} else {
				reject(new Error('ArrayBuffer 변환 실패'));
			}
		};
		
		reader.onerror = () => {
			reject(new Error(`파일 읽기 실패: ${reader.error?.message || '알 수 없음'}`));
		};
		
		reader.readAsArrayBuffer(file);
	});
}

/**
 * ArrayBuffer를 Data URL로 변환
 */
function arrayBufferToDataURL(buffer: ArrayBuffer, mimeType: string): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * ArrayBuffer를 Blob으로 변환
 */
function arrayBufferToBlob(buffer: ArrayBuffer, mimeType: string): Blob {
	return new Blob([buffer], { type: mimeType });
}

interface FileData {
	buffer: ArrayBuffer;
	name: string;
	size: number;
	type: string;
}

/**
 * 방법 1: createImageBitmap (ArrayBuffer 기반)
 */
async function loadWithImageBitmap(fileData: FileData, timeout: number): Promise<HTMLImageElement> {
	const startTime = Date.now();
	
	// createImageBitmap 지원 확인
	if (typeof createImageBitmap !== 'function') {
		const error = 'createImageBitmap 미지원';
		addLog({
			method: 'ImageBitmap',
			success: false,
			duration: Date.now() - startTime,
			fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
			error
		});
		throw new Error(error);
	}

	return new Promise(async (resolve, reject) => {
		const timeoutId = setTimeout(() => {
			const error = 'ImageBitmap 타임아웃';
			addLog({
				method: 'ImageBitmap',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		}, timeout);

		try {
			const blob = arrayBufferToBlob(fileData.buffer, fileData.type || 'image/jpeg');
			const bitmap = await createImageBitmap(blob);
			clearTimeout(timeoutId);
			
			// ImageBitmap을 Canvas를 통해 HTMLImageElement로 변환
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				bitmap.close();
				throw new Error('Canvas context 생성 실패');
			}
			
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			
			// Canvas를 Data URL로 변환하여 Image 생성
			const dataURL = canvas.toDataURL('image/jpeg', 0.95);
			const img = new Image();
			
			img.onload = () => {
				addLog({
					method: 'ImageBitmap',
					success: true,
					duration: Date.now() - startTime,
					fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type }
				});
				resolve(img);
			};
			
			img.onerror = () => {
				const error = 'ImageBitmap->Image 변환 실패';
				addLog({
					method: 'ImageBitmap',
					success: false,
					duration: Date.now() - startTime,
					fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
					error
				});
				reject(new Error(error));
			};
			
			img.src = dataURL;
			
		} catch (err) {
			clearTimeout(timeoutId);
			const error = `ImageBitmap 생성 실패: ${err instanceof Error ? err.message : err}`;
			addLog({
				method: 'ImageBitmap',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		}
	});
}

/**
 * 방법 2: Data URL (ArrayBuffer 기반)
 */
async function loadWithDataURL(fileData: FileData, timeout: number): Promise<HTMLImageElement> {
	const startTime = Date.now();
	
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			const error = 'DataURL 타임아웃';
			addLog({
				method: 'DataURL',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		}, timeout);

		try {
			const dataURL = arrayBufferToDataURL(fileData.buffer, fileData.type || 'image/jpeg');
			const img = new Image();
			
			img.onload = async () => {
				clearTimeout(timeoutId);
				try {
					if (typeof img.decode === 'function') {
						await img.decode();
					}
					addLog({
						method: 'DataURL',
						success: true,
						duration: Date.now() - startTime,
						fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type }
					});
					resolve(img);
				} catch (decodeErr) {
					addLog({
						method: 'DataURL',
						success: true,
						duration: Date.now() - startTime,
						fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
						error: `decode 경고: ${decodeErr}`
					});
					resolve(img);
				}
			};

			img.onerror = () => {
				clearTimeout(timeoutId);
				const error = 'Image.onload 실패 (DataURL)';
				addLog({
					method: 'DataURL',
					success: false,
					duration: Date.now() - startTime,
					fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
					error
				});
				reject(new Error(error));
			};

			img.src = dataURL;
		} catch (err) {
			clearTimeout(timeoutId);
			const error = `DataURL 변환 실패: ${err instanceof Error ? err.message : err}`;
			addLog({
				method: 'DataURL',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		}
	});
}

/**
 * 방법 3: Object URL (Blob 기반)
 */
async function loadWithObjectURL(fileData: FileData, timeout: number): Promise<HTMLImageElement> {
	const startTime = Date.now();
	const blob = arrayBufferToBlob(fileData.buffer, fileData.type || 'image/jpeg');
	const url = URL.createObjectURL(blob);
	
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			URL.revokeObjectURL(url);
			const error = 'ObjectURL 타임아웃';
			addLog({
				method: 'ObjectURL',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		}, timeout);

		const img = new Image();

		img.onload = async () => {
			clearTimeout(timeoutId);
			try {
				if (typeof img.decode === 'function') {
					await img.decode();
				}
				URL.revokeObjectURL(url);
				addLog({
					method: 'ObjectURL',
					success: true,
					duration: Date.now() - startTime,
					fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type }
				});
				resolve(img);
			} catch (decodeErr) {
				URL.revokeObjectURL(url);
				addLog({
					method: 'ObjectURL',
					success: true,
					duration: Date.now() - startTime,
					fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
					error: `decode 경고: ${decodeErr}`
				});
				resolve(img);
			}
		};

		img.onerror = () => {
			clearTimeout(timeoutId);
			URL.revokeObjectURL(url);
			const error = 'Image.onload 실패 (ObjectURL)';
			addLog({
				method: 'ObjectURL',
				success: false,
				duration: Date.now() - startTime,
				fileInfo: { name: fileData.name, size: fileData.size, type: fileData.type },
				error
			});
			reject(new Error(error));
		};

		img.src = url;
	});
}

/**
 * 3가지 방법을 순차적으로 시도하여 이미지 로드
 */
async function loadImageRobust(fileData: FileData, timeout: number = 60000): Promise<HTMLImageElement> {
	const methods = [
		{ name: 'DataURL', fn: () => loadWithDataURL(fileData, timeout) },
		{ name: 'ObjectURL', fn: () => loadWithObjectURL(fileData, timeout) },
		{ name: 'ImageBitmap', fn: () => loadWithImageBitmap(fileData, timeout) }
	];

	const errors: string[] = [];

	for (const method of methods) {
		try {
			console.log(`[ImageLoad] ${method.name} 방법 시도 중...`);
			const img = await method.fn();
			console.log(`[ImageLoad] ${method.name} 성공!`);
			return img;
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			errors.push(`${method.name}: ${errorMsg}`);
			console.warn(`[ImageLoad] ${method.name} 실패:`, errorMsg);
		}
	}

	// 모든 방법 실패
	const finalError = `모든 이미지 로딩 방법 실패:\n${errors.join('\n')}`;
	console.error('[ImageLoad]', finalError);
	throw new Error('이미지를 불러올 수 없습니다. 다른 이미지를 시도해주세요.\n\n디버그 패널에서 상세 로그를 확인할 수 있습니다.');
}

/**
 * 이미지를 Canvas에 그리고 Blob으로 변환
 */
function imageToBlob(
	img: HTMLImageElement,
	width: number,
	height: number,
	quality: number,
	mimeType: string
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		try {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const ctx = canvas.getContext('2d');
			if (!ctx) {
				reject(new Error('Canvas context 생성 실패'));
				return;
			}

			// 흰색 배경 (PNG 투명도 처리)
			ctx.fillStyle = '#FFFFFF';
			ctx.fillRect(0, 0, width, height);

			// 부드러운 리사이징을 위한 설정
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';

			ctx.drawImage(img, 0, 0, width, height);

			canvas.toBlob(
				(blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Blob 생성 실패'));
					}
				},
				mimeType,
				quality
			);
		} catch (error) {
			reject(new Error(`Canvas 처리 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`));
		}
	});
}

/**
 * HEIC/HEIF 포맷 확인
 */
function isHEICFormat(file: File): boolean {
	const type = file.type.toLowerCase();
	const name = file.name.toLowerCase();
	return (
		type === 'image/heic' ||
		type === 'image/heif' ||
		name.endsWith('.heic') ||
		name.endsWith('.heif')
	);
}

/**
 * 지원하는 이미지 타입인지 확인
 */
export function isSupportedImageType(file: File): { supported: boolean; message?: string } {
	const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
	
	if (isHEICFormat(file)) {
		return {
			supported: false,
			message: 'HEIC/HEIF 형식은 지원하지 않습니다. iPhone 설정에서 "가장 호환성이 높은 형식"으로 변경하거나 JPEG/PNG로 변환해주세요.'
		};
	}
	
	// MIME 타입이 없거나 알 수 없는 경우도 허용 (모바일에서 종종 발생)
	if (!file.type || file.type === '' || file.type === 'application/octet-stream') {
		// 확장자로 확인
		const name = file.name.toLowerCase();
		const hasValidExtension = 
			name.endsWith('.jpg') || 
			name.endsWith('.jpeg') || 
			name.endsWith('.png') || 
			name.endsWith('.webp') || 
			name.endsWith('.gif');
		
		if (hasValidExtension) {
			return { supported: true };
		}
		
		// 확장자도 없으면 일단 시도해보기 (모바일 카메라에서 종종 발생)
		console.warn('[ImageType] MIME 타입 없음, 확장자 확인 불가. 시도해봅니다:', file.name);
		return { supported: true };
	}
	
	if (!supportedTypes.includes(file.type)) {
		// MIME 타입이 있지만 지원하지 않는 경우
		const name = file.name.toLowerCase();
		const hasValidExtension = 
			name.endsWith('.jpg') || 
			name.endsWith('.jpeg') || 
			name.endsWith('.png') || 
			name.endsWith('.webp') || 
			name.endsWith('.gif');
		
		if (hasValidExtension) {
			// 확장자는 올바르므로 허용
			return { supported: true };
		}
		
		return {
			supported: false,
			message: `지원하지 않는 파일 형식입니다: ${file.type}. JPEG, PNG, WebP, GIF 형식을 사용해주세요.`
		};
	}
	
	return { supported: true };
}

/**
 * 이미지를 축소/압축하여 목표 크기 이하로 만들기
 */
export async function shrinkImage(
	file: File,
	options: ShrinkOptions = {}
): Promise<ShrinkResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const originalSize = file.size;

	console.log('[Shrink] 이미지 처리 시작:', {
		name: file.name,
		size: file.size,
		type: file.type
	});

	// 이미지 타입 확인
	const typeCheck = isSupportedImageType(file);
	if (!typeCheck.supported) {
		throw new Error(typeCheck.message);
	}

	// ⭐ 핵심: 파일을 즉시 ArrayBuffer로 읽어서 메모리에 저장
	// 모바일에서 파일 참조가 무효화되는 문제 방지
	console.log('[Shrink] 파일을 메모리로 복사 중...');
	let buffer: ArrayBuffer;
	try {
		buffer = await readFileAsArrayBuffer(file);
		console.log('[Shrink] 파일 메모리 복사 완료:', buffer.byteLength, 'bytes');
	} catch (err) {
		console.error('[Shrink] 파일 읽기 실패:', err);
		throw new Error(`파일을 읽을 수 없습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
	}

	const fileData: FileData = {
		buffer,
		name: file.name,
		size: file.size,
		type: file.type || 'image/jpeg'
	};

	return shrinkImageFromFileData(fileData, opts);
}

/**
 * 이미 메모리에 있는 파일 데이터로 이미지 축소/압축
 * (모바일에서 파일 참조 문제 해결용)
 */
export async function shrinkImageFromBuffer(
	fileData: { buffer: ArrayBuffer; name: string; size: number; type: string },
	options: ShrinkOptions = {}
): Promise<ShrinkResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	
	console.log('[ShrinkFromBuffer] 이미지 처리 시작:', {
		name: fileData.name,
		size: fileData.size,
		type: fileData.type
	});

	return shrinkImageFromFileData(fileData, opts);
}

/**
 * FileData로 이미지 축소/압축 (내부 공통 함수)
 */
async function shrinkImageFromFileData(
	fileData: FileData,
	opts: Required<ShrinkOptions>
): Promise<ShrinkResult> {
	const originalSize = fileData.size;

	// 이미지 로드 (3가지 방법 시도)
	const img = await loadImageRobust(fileData, opts.timeout);
	
	const originalWidth = img.naturalWidth || img.width;
	const originalHeight = img.naturalHeight || img.height;

	console.log('[Shrink] 이미지 로드 완료:', { originalWidth, originalHeight });

	// 유효한 이미지 크기 확인
	if (originalWidth === 0 || originalHeight === 0) {
		throw new Error('이미지 크기를 확인할 수 없습니다. 손상된 파일일 수 있습니다.');
	}

	// 출력 MIME 타입 결정 (JPEG로 통일하여 압축률 최적화)
	const mimeType = 'image/jpeg';

	let scale = 1.0;
	let quality = opts.initialQuality;
	let blob: Blob | null = null;
	let finalWidth = originalWidth;
	let finalHeight = originalHeight;

	// 초기 크기 제한 적용
	if (originalWidth > opts.maxDimension || originalHeight > opts.maxDimension) {
		scale = opts.maxDimension / Math.max(originalWidth, originalHeight);
	}

	// 반복적으로 품질/스케일 조정하여 목표 크기 달성
	while (scale >= opts.minScale) {
		finalWidth = Math.round(originalWidth * scale);
		finalHeight = Math.round(originalHeight * scale);

		// 최소 크기 보장
		if (finalWidth < 10) finalWidth = 10;
		if (finalHeight < 10) finalHeight = 10;

		// 품질 조정 루프
		quality = opts.initialQuality;
		while (quality >= opts.minQuality) {
			try {
				blob = await imageToBlob(img, finalWidth, finalHeight, quality, mimeType);

				if (blob.size <= opts.maxSizeBytes) {
					console.log('[Shrink] 완료:', { finalWidth, finalHeight, quality, size: blob.size });
					return {
						blob,
						originalSize,
						finalSize: blob.size,
						originalWidth,
						originalHeight,
						finalWidth,
						finalHeight,
						quality,
						scale,
						mimeType
					};
				}
			} catch (error) {
				console.warn('[Shrink] 변환 실패, 재시도:', error);
			}

			quality -= opts.qualityStep;
		}

		scale -= opts.scaleStep;
	}

	// 최소 설정으로 마지막 시도
	finalWidth = Math.round(originalWidth * opts.minScale);
	finalHeight = Math.round(originalHeight * opts.minScale);
	
	if (finalWidth < 10) finalWidth = 10;
	if (finalHeight < 10) finalHeight = 10;
	
	blob = await imageToBlob(img, finalWidth, finalHeight, opts.minQuality, mimeType);

	console.log('[Shrink] 최소 설정 완료:', { finalWidth, finalHeight, size: blob.size });

	return {
		blob,
		originalSize,
		finalSize: blob.size,
		originalWidth,
		originalHeight,
		finalWidth,
		finalHeight,
		quality: opts.minQuality,
		scale: opts.minScale,
		mimeType
	};
}

/**
 * 바이트 크기를 사람이 읽기 쉬운 형식으로 변환
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 이미지가 압축이 필요한지 확인
 */
export function needsShrink(file: File, maxSizeBytes: number = 4.2 * 1024 * 1024): boolean {
	return file.size > maxSizeBytes;
}
