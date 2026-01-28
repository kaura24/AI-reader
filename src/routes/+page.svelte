<script lang="ts">
	import {
		shrinkImage,
		shrinkImageFromBuffer,
		formatBytes,
		needsShrink,
		isSupportedImageType,
		getLoadLogs,
		clearLoadLogs,
		type ShrinkResult,
		type ImageLoadLog,
	} from "$lib/client/imageShrink";
	import { onMount } from "svelte";

	// 상태
	let selectedFile: File | null = null;
	let shrinkResult: ShrinkResult | null = null;
	let productCode = ""; // 대상 상품번호
	let isProcessing = false;
	let isDragging = false;
	let errorMessage = "";

	// 이미지 로딩 디버그 로그
	let imageLoadLogs: ImageLoadLog[] = [];

	// 카메라/파일 입력 참조
	let fileInputRef: HTMLInputElement;
	let cameraInputRef: HTMLInputElement;
	// 결과 항목 타입
	interface ResultItem {
		product_code: string;
		business_reg_no: string;
		company_name?: string;
		row_index?: number;
	}

	let successResult: {
		product_code: string;
		items: ResultItem[]; // 다중 결과
		total_found: number; // 찾은 총 개수
		confidence: number; // 신뢰도
		emailed: boolean;
		email_debug?: {
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
		};
		provider: string;
		request_id: string;
	} | null = null;

	// 디버깅 모드
	let showDebugPanel = false;

	// AI 연결 상태 (헤더 표시용)
	let aiStatus: "checking" | "connected" | "disconnected" = "checking";
	let aiModelName = "";

	// OpenAI API 연결 테스트 상태
	let isTestingConnection = false;
	let connectionStatus: "idle" | "success" | "error" = "idle";
	let connectionMessage = "";
	let connectionDetails: {
		model?: string;
		x_request_id?: string;
		processing_ms?: string;
	} | null = null;

	// 페이지 로드 시 AI 연결 상태 자동 확인
	onMount(async () => {
		await checkAIStatus();
	});

	// AI 연결 상태 확인
	async function checkAIStatus() {
		aiStatus = "checking";
		try {
			const response = await fetch("/api/test-connection");
			const result = await response.json();
			if (result.ok) {
				aiStatus = "connected";
				aiModelName = result.configured_model || "Unknown";
			} else {
				aiStatus = "disconnected";
				aiModelName = "";
			}
		} catch {
			aiStatus = "disconnected";
			aiModelName = "";
		}
	}

	// Resend API 연결 테스트 상태
	let isTestingResend = false;
	let resendStatus: "idle" | "success" | "error" = "idle";
	let resendMessage = "";
	let resendDetails: {
		sender_email?: string;
		recipient_email?: string;
		domains?: Array<{ name: string; status: string }>;
		api_key_prefix?: string;
		email_test?: {
			success: boolean;
			message_id?: string;
			error?: string;
		};
	} | null = null;

	// OpenAI API 연결 테스트
	async function testConnection() {
		isTestingConnection = true;
		connectionStatus = "idle";
		connectionMessage = "";
		connectionDetails = null;

		try {
			const response = await fetch("/api/test-connection");
			const result = await response.json();

			if (result.ok) {
				connectionStatus = "success";
				connectionMessage = `✅ ${result.message}`;
				connectionDetails = {
					model: result.configured_model,
					x_request_id: result.x_request_id,
					processing_ms: result.processing_ms,
				};
			} else {
				connectionStatus = "error";
				connectionMessage = `❌ ${result.message}`;
			}
		} catch (e) {
			connectionStatus = "error";
			connectionMessage = `❌ 연결 실패: ${e instanceof Error ? e.message : "네트워크 오류"}`;
		} finally {
			isTestingConnection = false;
		}
	}

	// Resend API 연결 테스트
	async function testResend(sendTestEmail = false) {
		isTestingResend = true;
		resendStatus = "idle";
		resendMessage = "";
		resendDetails = null;

		try {
			const url = sendTestEmail
				? "/api/test-resend?send=true"
				: "/api/test-resend";
			const response = await fetch(url);
			const result = await response.json();

			if (result.ok) {
				resendStatus = "success";
				resendMessage = `✅ ${result.message}`;
				resendDetails = {
					sender_email: result.config?.sender_email,
					recipient_email: result.config?.recipient_email,
					domains: result.domains,
					api_key_prefix: result.config?.api_key_prefix,
					email_test: result.email_test,
				};
			} else {
				resendStatus = "error";
				resendMessage = `❌ ${result.message}`;
				if (result.details) {
					resendDetails = { ...result.details };
				}
			}
		} catch (e) {
			resendStatus = "error";
			resendMessage = `❌ 연결 실패: ${e instanceof Error ? e.message : "네트워크 오류"}`;
		} finally {
			isTestingResend = false;
		}
	}

	// 파일 데이터 저장 (메모리 복사본)
	let cachedFileData: {
		buffer: ArrayBuffer;
		name: string;
		size: number;
		type: string;
	} | null = null;

	// 파일을 즉시 ArrayBuffer로 읽기 (동기적으로 시작)
	function readFileImmediately(file: File): void {
		errorMessage = "";
		successResult = null;
		selectedFile = file;
		shrinkResult = null;
		isLoadingImage = true;
		cachedFileData = null;

		// 이전 로그 클리어
		clearLoadLogs();

		// 이미지 타입 체크
		const typeCheck = isSupportedImageType(file);
		if (!typeCheck.supported) {
			errorMessage =
				typeCheck.message || "지원하지 않는 파일 형식입니다.";
			selectedFile = null;
			isLoadingImage = false;
			imageLoadLogs = getLoadLogs();
			return;
		}

		// ⭐ 핵심: 이벤트 핸들러 내에서 즉시 동기적으로 FileReader 시작
		const reader = new FileReader();

		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				cachedFileData = {
					buffer: reader.result,
					name: file.name,
					size: file.size,
					type: file.type || "image/jpeg",
				};
				console.log(
					"[FileRead] 파일 메모리 복사 완료:",
					cachedFileData.size,
					"bytes",
				);
				// 메모리 복사 완료 후 이미지 처리 시작
				processFileFromMemory();
			} else {
				errorMessage = "파일을 읽을 수 없습니다.";
				selectedFile = null;
				isLoadingImage = false;
				imageLoadLogs = getLoadLogs();
			}
		};

		reader.onerror = () => {
			console.error("[FileRead] 파일 읽기 실패:", reader.error);
			errorMessage = `파일을 읽을 수 없습니다: ${reader.error?.message || "권한 문제"}`;
			selectedFile = null;
			isLoadingImage = false;
			imageLoadLogs = getLoadLogs();
		};

		// 즉시 읽기 시작 (이벤트 핸들러 컨텍스트 내)
		console.log("[FileRead] 파일 읽기 시작:", file.name, file.size);
		reader.readAsArrayBuffer(file);
	}

	// 메모리에 복사된 파일 데이터로 이미지 처리
	async function processFileFromMemory() {
		if (!cachedFileData) {
			errorMessage = "파일 데이터가 없습니다.";
			isLoadingImage = false;
			return;
		}

		try {
			// shrinkImageFromBuffer 사용
			shrinkResult = await shrinkImageFromBuffer(cachedFileData);
		} catch (e) {
			console.error("이미지 처리 오류:", e);
			errorMessage =
				e instanceof Error
					? e.message
					: "이미지 처리 중 오류가 발생했습니다. 다른 이미지를 시도해주세요.";
			selectedFile = null;
			shrinkResult = null;
		} finally {
			isLoadingImage = false;
			imageLoadLogs = getLoadLogs();
		}
	}

	// 파일 선택 핸들러 (동기 함수로 변경)
	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			readFileImmediately(input.files[0]);
		}
	}

	// 드래그 앤 드롭 핸들러
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
			readFileImmediately(event.dataTransfer.files[0]);
		}
	}

	// 이미지 로딩 상태
	let isLoadingImage = false;

	// 카메라 촬영 핸들러
	function openCamera() {
		cameraInputRef?.click();
	}

	// 파일 선택 열기
	function openFileSelector() {
		fileInputRef?.click();
	}

	// 카메라 촬영 결과 처리 (동기 함수로 변경)
	function handleCameraCapture(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			readFileImmediately(input.files[0]);
		}
	}

	// 제출 핸들러
	async function handleSubmit() {
		if (!selectedFile || !shrinkResult) return;

		// 대상 상품번호 설정
		let targetCodes = "";
		if (searchMode === "manual") {
			const trimmedCode = productCode.trim().replace(/\D/g, "");
			if (!trimmedCode) {
				errorMessage = "대상 상품번호를 입력해주세요.";
				return;
			}
			if (trimmedCode.length !== 5) {
				errorMessage = "상품번호는 5자리 숫자여야 합니다.";
				return;
			}
			targetCodes = trimmedCode;
		} else {
			// 소기업 모드: 고정된 대상 코드
			targetCodes = "03269,03275";
		}

		isProcessing = true;
		errorMessage = "";
		successResult = null;

		try {
			const formData = new FormData();
			formData.append("image", shrinkResult.blob, selectedFile.name);
			formData.append("productCode", targetCodes);

			const response = await fetch("/api/process-once", {
				method: "POST",
				body: formData,
			});

			const result = await response.json();

			if (!result.ok) {
				errorMessage = `[${result.error_code}] ${result.message}`;
				return;
			}

			successResult = {
				product_code: result.product_code,
				items: result.items || [],
				total_found: result.total_found || 0,
				confidence: result.confidence || 0,
				emailed: result.emailed,
				email_debug: result.email_debug,
				provider: result.provider,
				request_id: result.request_id,
			};
		} catch (e) {
			errorMessage = `요청 실패: ${e instanceof Error ? e.message : "네트워크 오류"}`;
		} finally {
			isProcessing = false;
		}
	}

	// 초기화
	function reset() {
		selectedFile = null;
		shrinkResult = null;
		productCode = "";
		errorMessage = "";
		successResult = null;
	}

	// 상품번호 입력 필터 (숫자만)
	function handleProductCodeInput(event: Event) {
		const input = event.target as HTMLInputElement;
		input.value = input.value.replace(/\D/g, "").slice(0, 5);
		productCode = input.value;
	}

	// 모드 상태
	let searchMode: "manual" | "small-business" = "manual";

	// 제출 버튼 활성화 조건
	$: canSubmit =
		selectedFile &&
		shrinkResult &&
		(searchMode === "small-business" ||
			(searchMode === "manual" &&
				productCode.replace(/\D/g, "").length === 5));
</script>

<svelte:head>
	<title>사업자등록번호 조회</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossorigin="anonymous"
	/>
	<link
		href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="app">
	<div class="container">
		<!-- 헤더 -->
		<header class="header">
			<div class="logo">
				<span class="logo-icon">🔍</span>
				<div class="logo-text">
					<h1>사업자등록번호 조회</h1>
					<p class="tagline">
						상품번호로 사업자등록번호를 자동 조회합니다
					</p>
				</div>
			</div>
			<!-- AI 연결 상태 표시 -->
			<div
				class="ai-status"
				class:connected={aiStatus === "connected"}
				class:disconnected={aiStatus === "disconnected"}
				class:checking={aiStatus === "checking"}
			>
				{#if aiStatus === "checking"}
					<span class="status-indicator checking"></span>
					<span class="status-text">AI 연결 확인 중...</span>
				{:else if aiStatus === "connected"}
					<span class="status-indicator connected"></span>
					<span class="status-text">AI 연결됨</span>
					<span class="model-name">{aiModelName}</span>
				{:else}
					<span class="status-indicator disconnected"></span>
					<span class="status-text">AI 연결 안됨</span>
					<button class="retry-btn" onclick={checkAIStatus}
						>재시도</button
					>
				{/if}
			</div>
		</header>

		<!-- 디버깅 패널 토글 -->
		<div class="debug-toggle">
			<button
				class="debug-toggle-btn"
				onclick={() => (showDebugPanel = !showDebugPanel)}
			>
				🛠️ {showDebugPanel ? "디버깅 패널 숨기기" : "디버깅 패널 열기"}
			</button>
		</div>

		{#if showDebugPanel}
			<!-- API 연결 테스트 섹션 -->
			<section class="connection-section">
				<div class="connection-header">
					<span class="connection-title">🔌 OpenAI API 연결 상태</span
					>
					<button
						class="test-btn"
						onclick={testConnection}
						disabled={isTestingConnection}
					>
						{#if isTestingConnection}
							<span class="spinner-small"></span>
							테스트 중...
						{:else}
							연결 테스트
						{/if}
					</button>
				</div>

				{#if connectionStatus !== "idle"}
					<div
						class="connection-result"
						class:success={connectionStatus === "success"}
						class:error={connectionStatus === "error"}
					>
						<p class="connection-message">{connectionMessage}</p>
						{#if connectionDetails}
							<div class="connection-details">
								<span
									>모델: <code>{connectionDetails.model}</code
									></span
								>
								{#if connectionDetails.processing_ms}
									<span
										>응답시간: <code
											>{connectionDetails.processing_ms}ms</code
										></span
									>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Resend API 연결 테스트 섹션 -->
			<section class="connection-section resend-section">
				<div class="connection-header">
					<span class="connection-title">📧 Resend API 연결 상태</span
					>
					<div class="test-btn-group">
						<button
							class="test-btn"
							onclick={() => testResend(false)}
							disabled={isTestingResend}
						>
							{#if isTestingResend}
								<span class="spinner-small"></span>
								테스트 중...
							{:else}
								연결 테스트
							{/if}
						</button>
						<button
							class="test-btn test-btn-secondary"
							onclick={() => testResend(true)}
							disabled={isTestingResend}
							title="실제 테스트 이메일을 발송합니다"
						>
							📤 테스트 이메일 발송
						</button>
					</div>
				</div>

				{#if resendStatus !== "idle"}
					<div
						class="connection-result"
						class:success={resendStatus === "success"}
						class:error={resendStatus === "error"}
					>
						<p class="connection-message">{resendMessage}</p>
						{#if resendDetails}
							<div class="resend-details">
								{#if resendDetails.sender_email}
									<div class="detail-row">
										<span class="detail-label">발신자:</span
										>
										<code>{resendDetails.sender_email}</code
										>
									</div>
								{/if}
								{#if resendDetails.recipient_email}
									<div class="detail-row">
										<span class="detail-label">수신자:</span
										>
										<code
											>{resendDetails.recipient_email}</code
										>
									</div>
								{/if}
								{#if resendDetails.api_key_prefix}
									<div class="detail-row">
										<span class="detail-label"
											>API Key:</span
										>
										<code
											>{resendDetails.api_key_prefix}</code
										>
									</div>
								{/if}
								{#if resendDetails.domains && resendDetails.domains.length > 0}
									<div class="detail-row">
										<span class="detail-label">도메인:</span
										>
										<div class="domain-list">
											{#each resendDetails.domains as domain}
												<span
													class="domain-badge"
													class:verified={domain.status ===
														"verified"}
												>
													{domain.name} ({domain.status})
												</span>
											{/each}
										</div>
									</div>
								{/if}
								{#if resendDetails.email_test}
									<div
										class="detail-row email-test-result"
										class:success={resendDetails.email_test
											.success}
										class:error={!resendDetails.email_test
											.success}
									>
										<span class="detail-label"
											>테스트 이메일:</span
										>
										{#if resendDetails.email_test.success}
											<span class="test-success"
												>✅ 발송 성공 (ID: {resendDetails
													.email_test
													.message_id})</span
											>
										{:else}
											<span class="test-error"
												>❌ 발송 실패: {resendDetails
													.email_test.error}</span
											>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- 이미지 로딩 디버그 로그 -->
			<section class="connection-section image-log-section">
				<div class="connection-header">
					<span class="connection-title">🖼️ 이미지 로딩 로그</span>
					<button
						class="test-btn"
						onclick={() => {
							clearLoadLogs();
							imageLoadLogs = [];
						}}
					>
						로그 삭제
					</button>
				</div>

				{#if imageLoadLogs.length > 0}
					<div class="image-log-list">
						{#each imageLoadLogs as log, index}
							<div
								class="log-entry"
								class:success={log.success}
								class:error={!log.success}
							>
								<div class="log-header">
									<span class="log-method">{log.method}</span>
									<span class="log-status"
										>{log.success
											? "✅ 성공"
											: "❌ 실패"}</span
									>
									<span class="log-duration"
										>{log.duration}ms</span
									>
								</div>
								<div class="log-details">
									<span>파일: {log.fileInfo.name}</span>
									<span
										>크기: {formatBytes(
											log.fileInfo.size,
										)}</span
									>
									<span
										>타입: {log.fileInfo.type ||
											"알 수 없음"}</span
									>
								</div>
								{#if log.error}
									<div class="log-error">{log.error}</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="no-logs">
						이미지 로딩 로그가 없습니다. 이미지를 선택하면 로그가
						표시됩니다.
					</p>
				{/if}
			</section>
		{/if}

		<!-- 메인 컨텐츠 -->
		<main class="main">
			{#if !successResult}
				<!-- 검색 모드 선택 -->
				<div class="search-mode-tabs">
					<button
						class="mode-btn"
						class:active={searchMode === "manual"}
						onclick={() => (searchMode = "manual")}
					>
						📝 직접 입력
					</button>
					<button
						class="mode-btn"
						class:active={searchMode === "small-business"}
						onclick={() => (searchMode = "small-business")}
					>
						🏢 소기업 상품조회
					</button>
				</div>

				<!-- 대상 상품번호 입력 (직접 입력 모드일 때만 표시) -->
				{#if searchMode === "manual"}
					<div class="product-code-section">
						<label for="product-code" class="input-label">
							🏷️ 상품번호
							<span class="required">*</span>
						</label>
						<input
							id="product-code"
							type="text"
							bind:value={productCode}
							oninput={handleProductCodeInput}
							placeholder="5자리 숫자 입력 (예: 12345)"
							class="product-code-input"
							maxlength="5"
							inputmode="numeric"
							pattern="[0-9]*"
						/>
						<p class="input-hint">
							이미지에서 이 상품번호와 같은 행의 사업자등록번호를
							추출합니다.
						</p>
					</div>
				{:else}
					<div class="product-code-section">
						<div class="small-business-info">
							<span class="info-icon">ℹ️</span>
							<p>
								소기업 상품코드 <strong>03269</strong> 또는
								<strong>03275</strong>를 자동으로 찾습니다.
							</p>
						</div>
					</div>
				{/if}

				<!-- 숨겨진 파일/카메라 입력 -->
				<!-- 갤러리용: accept="image/*"만 사용하면 안드로이드에서 바로 갤러리 열림 -->
				<input
					bind:this={fileInputRef}
					type="file"
					accept="image/*"
					onchange={handleFileSelect}
					hidden
				/>
				<!-- 카메라용: capture 속성으로 카메라 직접 열기 -->
				<input
					bind:this={cameraInputRef}
					type="file"
					accept="image/*"
					capture="environment"
					onchange={handleCameraCapture}
					hidden
				/>

				<!-- 이미지 선택 버튼들 -->
				<div class="image-select-buttons">
					<button
						type="button"
						class="image-btn gallery-btn"
						onclick={openFileSelector}
						disabled={isLoadingImage}
					>
						🖼️ 갤러리에서 선택
					</button>
					<button
						type="button"
						class="image-btn camera-btn"
						onclick={openCamera}
						disabled={isLoadingImage}
					>
						📸 카메라로 촬영
					</button>
				</div>

				<!-- 업로드 영역 -->
				<div
					class="upload-zone"
					class:dragging={isDragging}
					class:has-file={selectedFile}
					role="button"
					tabindex="0"
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
					onclick={openFileSelector}
					onkeydown={(e) => e.key === "Enter" && openFileSelector()}
				>
					{#if isLoadingImage}
						<div class="upload-loading">
							<div class="loading-spinner"></div>
							<p class="loading-text">이미지 처리 중...</p>
							<p class="loading-hint">
								모바일에서는 시간이 걸릴 수 있습니다
							</p>
						</div>
					{:else if !selectedFile}
						<div class="upload-placeholder">
							<div class="upload-icon">📷</div>
							<p class="upload-title">
								이미지를 드래그하거나 클릭하여 업로드
							</p>
							<p class="upload-hint">
								상품번호와 사업자등록번호가 포함된 이미지
							</p>
						</div>
					{:else if shrinkResult}
						<div class="preview-container">
							<img
								src={URL.createObjectURL(shrinkResult.blob)}
								alt="Preview"
								class="preview-image"
							/>
							<button
								class="change-btn"
								onclick={(e) => {
									e.stopPropagation();
									reset();
								}}
							>
								변경
							</button>
						</div>
					{/if}
				</div>

				<!-- 리사이즈 정보 -->
				{#if shrinkResult}
					<div class="resize-info">
						<h3 class="info-title">📊 이미지 정보</h3>
						<div class="info-grid">
							<div class="info-item">
								<span class="info-label">원본 크기</span>
								<span class="info-value"
									>{formatBytes(
										shrinkResult.originalSize,
									)}</span
								>
							</div>
							<div class="info-item">
								<span class="info-label">최종 크기</span>
								<span class="info-value highlight"
									>{formatBytes(shrinkResult.finalSize)}</span
								>
							</div>
							<div class="info-item">
								<span class="info-label">원본 해상도</span>
								<span class="info-value"
									>{shrinkResult.originalWidth} × {shrinkResult.originalHeight}</span
								>
							</div>
							<div class="info-item">
								<span class="info-label">최종 해상도</span>
								<span class="info-value"
									>{shrinkResult.finalWidth} × {shrinkResult.finalHeight}</span
								>
							</div>
						</div>
					</div>
				{/if}

				<!-- 에러 메시지 -->
				{#if errorMessage}
					<div class="error-box">
						<span class="error-icon">⚠️</span>
						<span class="error-text">{errorMessage}</span>
					</div>
				{/if}

				<!-- 제출 버튼 -->
				<button
					class="submit-btn"
					onclick={handleSubmit}
					disabled={!canSubmit || isProcessing}
				>
					{#if isProcessing}
						<span class="spinner"></span>
						조회 중...
					{:else}
						🚀 사업자등록번호 조회
					{/if}
				</button>

				<!-- 이메일 안내 -->
				<div class="email-notice">
					📧 결과는 <strong>kaura24@gmail.com</strong>으로 발송됩니다.
				</div>
			{:else}
				<!-- 성공 결과 -->
				<div class="success-card">
					<div class="success-header">
						<span class="success-icon">✅</span>
						<h2>조회 완료</h2>
						<span class="found-badge"
							>{successResult.total_found}건 발견</span
						>
					</div>

					<!-- 검색 요약 -->
					<div class="search-summary">
						<div class="summary-item">
							<span class="summary-label">검색 상품번호</span>
							<span class="summary-value code"
								>{successResult.product_code}</span
							>
						</div>
						<div class="summary-item">
							<span class="summary-label">신뢰도</span>
							<span class="summary-value confidence"
								>{(successResult.confidence * 100).toFixed(
									1,
								)}%</span
							>
						</div>
					</div>

					<!-- 결과 테이블 (다중 결과) -->
					<div class="results-table-container">
						<table class="results-table">
							<thead>
								<tr>
									<th class="col-num">순번</th>
									<th class="col-code">상품번호</th>
									<th class="col-company">업체명</th>
									<th class="col-business">사업자등록번호</th>
								</tr>
							</thead>
							<tbody>
								{#each successResult.items as item, index}
									<tr>
										<td class="col-num">{index + 1}</td>
										<td class="col-code"
											>{item.product_code}</td
										>
										<td class="col-company"
											>{item.company_name || "-"}</td
										>
										<td class="col-business"
											>{item.business_reg_no}</td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- 메타 정보 -->
					<div class="result-meta">
						<div class="meta-item">
							<span class="meta-label">이메일 발송</span>
							<span
								class="meta-value"
								class:success={successResult.emailed}
								class:fail={!successResult.emailed}
							>
								{successResult.emailed ? "✓ 성공" : "✗ 실패"}
							</span>
						</div>
						<div class="meta-item">
							<span class="meta-label">처리 엔진</span>
							<span class="meta-value provider"
								>{successResult.provider.toUpperCase()}</span
							>
						</div>
					</div>

					{#if successResult.emailed}
						<div class="email-sent-notice">
							📧 결과가 <strong
								>{successResult.email_debug?.recipient_email ||
									"수신자"}</strong
							>로 발송되었습니다.
						</div>
					{:else}
						<div class="email-failed-notice">
							⚠️ 이메일 발송에 실패했습니다. (상세 정보는 아래
							참조)
						</div>
					{/if}

					<!-- 이메일 디버깅 정보 -->
					{#if successResult.email_debug}
						<details class="email-debug-details">
							<summary class="email-debug-summary">
								📋 이메일 발송 상세 정보 {successResult
									.email_debug.success
									? "✅"
									: "❌"}
							</summary>
							<div class="email-debug-content">
								<div class="debug-row">
									<span class="debug-label">발신자:</span>
									<code
										>{successResult.email_debug
											.sender_email || "N/A"}</code
									>
								</div>
								<div class="debug-row">
									<span class="debug-label">수신자:</span>
									<code
										>{successResult.email_debug
											.recipient_email || "N/A"}</code
									>
								</div>
								<div class="debug-row">
									<span class="debug-label">발송 시도:</span>
									<span
										>{successResult.email_debug.attempted
											? "예"
											: "아니오"}</span
									>
								</div>
								<div class="debug-row">
									<span class="debug-label">발송 성공:</span>
									<span
										class:success-text={successResult
											.email_debug.success}
										class:error-text={!successResult
											.email_debug.success}
									>
										{successResult.email_debug.success
											? "✅ 성공"
											: "❌ 실패"}
									</span>
								</div>
								{#if successResult.email_debug.message_id}
									<div class="debug-row">
										<span class="debug-label"
											>Message ID:</span
										>
										<code
											>{successResult.email_debug
												.message_id}</code
										>
									</div>
								{/if}
								{#if successResult.email_debug.error}
									<div class="debug-row error-row">
										<span class="debug-label">오류:</span>
										<span class="error-text"
											>{successResult.email_debug
												.error}</span
										>
									</div>
								{/if}
								{#if successResult.email_debug.error_details}
									<div class="debug-row error-row">
										<span class="debug-label"
											>오류 상세:</span
										>
										<pre
											class="error-details-pre">{JSON.stringify(
												successResult.email_debug
													.error_details,
												null,
												2,
											)}</pre>
									</div>
								{/if}
							</div>
						</details>
					{/if}

					<div class="request-id">
						요청 ID: <code>{successResult.request_id}</code>
					</div>

					<button class="reset-btn" onclick={reset}>
						🔄 새로운 조회
					</button>
				</div>
			{/if}
		</main>

		<!-- 푸터 -->
		<footer class="footer">
			<p>
				💡 이미지에서 입력한 상품번호(5자리)를 찾아 같은 행의
				사업자등록번호(000-00-00000)를 추출합니다.
			</p>
		</footer>
	</div>
</div>

<style>
	:global(*) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	:global(body) {
		font-family:
			"Noto Sans KR",
			-apple-system,
			BlinkMacSystemFont,
			sans-serif;
		background: linear-gradient(
			145deg,
			#0c0c0c 0%,
			#1a1a2e 50%,
			#0f0f1a 100%
		);
		min-height: 100vh;
		color: #e4e4e7;
	}

	.app {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.container {
		width: 100%;
		max-width: 540px;
	}

	/* 헤더 */
	.header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.logo {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}

	.logo-icon {
		font-size: 3rem;
		filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.5));
	}

	.logo-text h1 {
		font-size: 1.75rem;
		font-weight: 700;
		background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.tagline {
		font-size: 0.9rem;
		color: #71717a;
		margin-top: 0.25rem;
	}

	.input-hint {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-top: 0.5rem;
	}

	/* 검색 모드 탭 스타일 */
	.search-mode-tabs {
		display: flex;
		background-color: var(--bg-tertiary);
		border-radius: var(--radius-md);
		padding: 0.25rem;
		margin-bottom: 1.5rem;
		gap: 0.25rem;
	}

	.mode-btn {
		flex: 1;
		padding: 0.75rem;
		border: none;
		background: none;
		border-radius: var(--radius-sm);
		font-family: var(--font-main);
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.mode-btn.active {
		background-color: var(--bg-primary);
		color: var(--primary);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		font-weight: 600;
	}

	.small-business-info {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.info-icon {
		font-size: 1.25rem;
	}

	.small-business-info p {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.small-business-info strong {
		color: var(--primary);
		font-weight: 600;
	}

	/* AI 연결 상태 표시 */
	.ai-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-size: 0.85rem;
		font-weight: 500;
		transition: all 0.3s ease;
	}

	.ai-status.checking {
		background: rgba(251, 191, 36, 0.15);
		border: 1px solid rgba(251, 191, 36, 0.3);
		color: #fbbf24;
	}

	.ai-status.connected {
		background: rgba(34, 197, 94, 0.15);
		border: 1px solid rgba(34, 197, 94, 0.3);
		color: #4ade80;
	}

	.ai-status.disconnected {
		background: rgba(239, 68, 68, 0.15);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: #f87171;
	}

	.status-indicator {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		animation: pulse 2s infinite;
	}

	.status-indicator.checking {
		background: #fbbf24;
	}

	.status-indicator.connected {
		background: #22c55e;
		box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
		animation: none;
	}

	.status-indicator.disconnected {
		background: #ef4444;
		box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
		animation: none;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.status-text {
		font-weight: 500;
	}

	.model-name {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		background: rgba(34, 197, 94, 0.2);
		border-radius: 4px;
		color: #86efac;
	}

	.retry-btn {
		padding: 0.25rem 0.75rem;
		background: rgba(239, 68, 68, 0.2);
		border: 1px solid rgba(239, 68, 68, 0.4);
		border-radius: 12px;
		color: #fca5a5;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.retry-btn:hover {
		background: rgba(239, 68, 68, 0.3);
		color: #fecaca;
	}

	/* 연결 테스트 섹션 */
	.connection-section {
		background: rgba(24, 24, 27, 0.6);
		border-radius: 16px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		border: 1px solid rgba(63, 63, 70, 0.4);
	}

	.connection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.connection-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: #a1a1aa;
	}

	.test-btn {
		padding: 0.5rem 1rem;
		background: rgba(99, 102, 241, 0.2);
		border: 1px solid rgba(99, 102, 241, 0.4);
		border-radius: 8px;
		color: #818cf8;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.test-btn:hover:not(:disabled) {
		background: rgba(99, 102, 241, 0.3);
	}

	.test-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner-small {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(129, 140, 248, 0.3);
		border-top-color: #818cf8;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.connection-result {
		margin-top: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		background: rgba(39, 39, 42, 0.5);
	}

	.connection-result.success {
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.3);
	}

	.connection-result.error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.connection-message {
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.connection-result.success .connection-message {
		color: #4ade80;
	}

	.connection-result.error .connection-message {
		color: #f87171;
	}

	.connection-details {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.8rem;
		color: #71717a;
	}

	.connection-details code {
		font-family: "JetBrains Mono", monospace;
		background: rgba(0, 0, 0, 0.3);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		color: #a1a1aa;
	}

	/* 이미지 로딩 로그 섹션 */
	.image-log-section {
		margin-top: 0;
	}

	.image-log-list {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.log-entry {
		padding: 0.75rem;
		border-radius: 8px;
		background: rgba(39, 39, 42, 0.5);
		font-size: 0.8rem;
	}

	.log-entry.success {
		border-left: 3px solid #22c55e;
	}

	.log-entry.error {
		border-left: 3px solid #ef4444;
	}

	.log-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.log-method {
		font-weight: 600;
		color: #d4d4d8;
	}

	.log-status {
		font-size: 0.75rem;
	}

	.log-duration {
		font-family: "JetBrains Mono", monospace;
		color: #a1a1aa;
		font-size: 0.75rem;
	}

	.log-details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		color: #71717a;
		font-size: 0.75rem;
	}

	.log-error {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: rgba(239, 68, 68, 0.1);
		border-radius: 4px;
		color: #fca5a5;
		font-size: 0.75rem;
		word-break: break-all;
	}

	.no-logs {
		margin-top: 0.5rem;
		color: #71717a;
		font-size: 0.85rem;
		text-align: center;
		padding: 1rem;
	}

	/* 메인 */
	.main {
		background: rgba(24, 24, 27, 0.8);
		backdrop-filter: blur(20px);
		border-radius: 24px;
		padding: 2rem;
		border: 1px solid rgba(63, 63, 70, 0.5);
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
	}

	/* 이미지 선택 버튼 */
	.image-select-buttons {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.image-btn {
		flex: 1;
		padding: 0.875rem 1rem;
		border-radius: 12px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.gallery-btn {
		background: rgba(99, 102, 241, 0.2);
		border: 2px solid rgba(99, 102, 241, 0.4);
		color: #a5b4fc;
	}

	.gallery-btn:hover:not(:disabled) {
		background: rgba(99, 102, 241, 0.3);
		border-color: rgba(99, 102, 241, 0.6);
	}

	.camera-btn {
		background: rgba(34, 197, 94, 0.2);
		border: 2px solid rgba(34, 197, 94, 0.4);
		color: #86efac;
	}

	.camera-btn:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.3);
		border-color: rgba(34, 197, 94, 0.6);
	}

	.image-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* 상품번호 입력 섹션 */
	.product-code-section {
		margin-bottom: 1.5rem;
	}

	.input-label {
		display: block;
		font-size: 0.95rem;
		font-weight: 600;
		color: #d4d4d8;
		margin-bottom: 0.5rem;
	}

	.required {
		color: #f87171;
		margin-left: 0.25rem;
	}

	.product-code-input {
		width: 100%;
		padding: 1rem 1.25rem;
		background: rgba(39, 39, 42, 0.8);
		border: 2px solid rgba(99, 102, 241, 0.3);
		border-radius: 12px;
		font-size: 1.5rem;
		font-family: "JetBrains Mono", monospace;
		color: #e4e4e7;
		transition: all 0.2s;
		letter-spacing: 0.2em;
		text-align: center;
	}

	.product-code-input:focus {
		outline: none;
		border-color: #818cf8;
		background: rgba(39, 39, 42, 1);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
	}

	.product-code-input::placeholder {
		color: #52525b;
		font-family: "Noto Sans KR", sans-serif;
		letter-spacing: normal;
		font-size: 1rem;
	}

	.input-hint {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #71717a;
	}

	/* 업로드 영역 */
	.upload-zone {
		border: 2px dashed rgba(99, 102, 241, 0.4);
		border-radius: 16px;
		padding: 3rem 2rem;
		text-align: center;
		cursor: pointer;
		transition: all 0.3s ease;
		background: rgba(99, 102, 241, 0.05);
	}

	.upload-zone:hover,
	.upload-zone.dragging {
		border-color: #818cf8;
		background: rgba(99, 102, 241, 0.1);
		transform: scale(1.01);
	}

	.upload-zone.has-file {
		padding: 1rem;
		border-style: solid;
		border-color: rgba(99, 102, 241, 0.6);
	}

	.upload-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.upload-icon {
		font-size: 4rem;
		opacity: 0.8;
	}

	.upload-title {
		font-size: 1.1rem;
		font-weight: 500;
		color: #a1a1aa;
	}

	.upload-hint {
		font-size: 0.85rem;
		color: #71717a;
	}

	/* 프리뷰 */
	.preview-container {
		position: relative;
		display: inline-block;
	}

	.preview-image {
		max-width: 100%;
		max-height: 300px;
		border-radius: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
	}

	.change-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		background: rgba(0, 0, 0, 0.7);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.change-btn:hover {
		background: rgba(0, 0, 0, 0.9);
	}

	/* 이미지 로딩 상태 */
	.upload-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		gap: 1rem;
	}

	.loading-spinner {
		width: 48px;
		height: 48px;
		border: 4px solid rgba(129, 140, 248, 0.2);
		border-top-color: #818cf8;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.loading-text {
		font-size: 1rem;
		font-weight: 500;
		color: #a1a1aa;
	}

	.loading-hint {
		font-size: 0.8rem;
		color: #71717a;
	}

	/* 리사이즈 정보 */
	.resize-info {
		margin-top: 1.5rem;
		padding: 1.25rem;
		background: rgba(39, 39, 42, 0.6);
		border-radius: 12px;
		border: 1px solid rgba(63, 63, 70, 0.3);
	}

	.info-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #a1a1aa;
		margin-bottom: 1rem;
	}

	.info-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.info-label {
		font-size: 0.75rem;
		color: #71717a;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.info-value {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.95rem;
		color: #d4d4d8;
	}

	.info-value.highlight {
		color: #34d399;
		font-weight: 500;
	}

	/* 에러 박스 */
	.error-box {
		margin-top: 1.5rem;
		padding: 1rem 1.25rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 12px;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.error-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.error-text {
		font-size: 0.9rem;
		color: #fca5a5;
		line-height: 1.5;
	}

	/* 이메일 안내 */
	.email-notice {
		margin-top: 1.5rem;
		padding: 0.75rem 1rem;
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.2);
		border-radius: 8px;
		font-size: 0.85rem;
		color: #a5b4fc;
		text-align: center;
	}

	.email-notice strong {
		color: #c7d2fe;
	}

	.email-sent-notice {
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.2);
		border-radius: 8px;
		font-size: 0.9rem;
		color: #86efac;
		text-align: center;
	}

	.email-sent-notice strong {
		color: #bbf7d0;
	}

	/* 제출 버튼 */
	.submit-btn {
		margin-top: 1.5rem;
		width: 100%;
		padding: 1rem 2rem;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border: none;
		border-radius: 12px;
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
	}

	.submit-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 15px 40px rgba(99, 102, 241, 0.4);
	}

	.submit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* 성공 카드 */
	.success-card {
		text-align: center;
	}

	.success-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.success-icon {
		font-size: 2.5rem;
	}

	.success-header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #34d399;
		margin: 0;
	}

	.found-badge {
		display: inline-block;
		padding: 0.35rem 0.85rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 20px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	/* 검색 요약 */
	.search-summary {
		display: flex;
		justify-content: center;
		gap: 2rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: rgba(39, 39, 42, 0.6);
		border-radius: 12px;
	}

	.summary-item {
		text-align: center;
	}

	.summary-label {
		display: block;
		font-size: 0.75rem;
		color: #71717a;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 0.35rem;
	}

	.summary-value {
		font-size: 1.1rem;
		font-weight: 600;
		color: #e4e4e7;
	}

	.summary-value.code {
		font-family: "JetBrains Mono", monospace;
		color: #818cf8;
		font-size: 1.25rem;
	}

	.summary-value.confidence {
		font-family: "JetBrains Mono", monospace;
		color: #34d399;
	}

	/* 결과 테이블 */
	.results-table-container {
		margin-bottom: 1.5rem;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid rgba(63, 63, 70, 0.5);
	}

	.results-table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	.results-table thead {
		background: rgba(51, 65, 85, 0.8);
	}

	.results-table th {
		padding: 0.85rem 1rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #cbd5e1;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.results-table tbody tr {
		background: rgba(39, 39, 42, 0.4);
		transition: background 0.2s;
	}

	.results-table tbody tr:nth-child(even) {
		background: rgba(39, 39, 42, 0.7);
	}

	.results-table tbody tr:hover {
		background: rgba(99, 102, 241, 0.15);
	}

	.results-table td {
		padding: 0.85rem 1rem;
		font-size: 0.95rem;
		color: #e4e4e7;
		border-top: 1px solid rgba(63, 63, 70, 0.3);
	}

	.results-table .col-num {
		width: 50px;
		text-align: center;
		color: #71717a;
	}

	.results-table .col-code {
		width: 90px;
		font-family: "JetBrains Mono", monospace;
		color: #818cf8;
	}

	.results-table .col-company {
		color: #e4e4e7;
	}

	.results-table .col-business {
		width: 140px;
		font-family: "JetBrains Mono", monospace;
		color: #34d399;
		font-weight: 600;
		font-size: 1.05rem;
	}

	/* 메타 정보 */
	.result-meta {
		display: flex;
		justify-content: center;
		gap: 2rem;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(39, 39, 42, 0.4);
		border-radius: 8px;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.meta-label {
		font-size: 0.8rem;
		color: #71717a;
	}

	.meta-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: #e4e4e7;
	}

	.meta-value.success {
		color: #34d399;
	}

	.meta-value.fail {
		color: #f87171;
	}

	.meta-value.provider {
		font-family: "JetBrains Mono", monospace;
		color: #a78bfa;
	}

	.request-id {
		font-size: 0.8rem;
		color: #52525b;
		margin-bottom: 1.5rem;
	}

	.request-id code {
		font-family: "JetBrains Mono", monospace;
		background: rgba(39, 39, 42, 0.8);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
	}

	.reset-btn {
		width: 100%;
		padding: 1rem 2rem;
		background: rgba(63, 63, 70, 0.5);
		color: #d4d4d8;
		border: 1px solid rgba(82, 82, 91, 0.5);
		border-radius: 12px;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.reset-btn:hover {
		background: rgba(63, 63, 70, 0.8);
		border-color: rgba(82, 82, 91, 0.8);
	}

	/* 푸터 */
	.footer {
		margin-top: 2rem;
		text-align: center;
	}

	.footer p {
		font-size: 0.85rem;
		color: #52525b;
		line-height: 1.6;
	}

	/* 디버깅 토글 */
	.debug-toggle {
		margin-bottom: 1rem;
		text-align: center;
	}

	.debug-toggle-btn {
		padding: 0.5rem 1rem;
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 8px;
		color: #fbbf24;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.debug-toggle-btn:hover {
		background: rgba(251, 191, 36, 0.2);
	}

	/* Resend 섹션 */
	.resend-section {
		margin-bottom: 1rem;
	}

	.test-btn-group {
		display: flex;
		gap: 0.5rem;
	}

	.test-btn-secondary {
		background: rgba(251, 191, 36, 0.2);
		border-color: rgba(251, 191, 36, 0.4);
		color: #fbbf24;
	}

	.test-btn-secondary:hover:not(:disabled) {
		background: rgba(251, 191, 36, 0.3);
	}

	.resend-details {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.detail-label {
		color: #71717a;
		min-width: 70px;
	}

	.detail-row code {
		font-family: "JetBrains Mono", monospace;
		background: rgba(0, 0, 0, 0.3);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		color: #a1a1aa;
		word-break: break-all;
	}

	.domain-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.domain-badge {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		background: rgba(239, 68, 68, 0.2);
		border-radius: 4px;
		color: #f87171;
	}

	.domain-badge.verified {
		background: rgba(34, 197, 94, 0.2);
		color: #4ade80;
	}

	.email-test-result {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(63, 63, 70, 0.3);
	}

	.test-success {
		color: #4ade80;
	}

	.test-error {
		color: #f87171;
	}

	/* 이메일 실패 알림 */
	.email-failed-notice {
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 8px;
		font-size: 0.9rem;
		color: #fca5a5;
		text-align: center;
	}

	/* 이메일 디버깅 상세 */
	.email-debug-details {
		margin-bottom: 1rem;
		background: rgba(39, 39, 42, 0.6);
		border-radius: 8px;
		overflow: hidden;
	}

	.email-debug-summary {
		padding: 0.75rem 1rem;
		cursor: pointer;
		font-size: 0.9rem;
		color: #a1a1aa;
		background: rgba(39, 39, 42, 0.8);
		transition: background 0.2s;
	}

	.email-debug-summary:hover {
		background: rgba(52, 52, 56, 0.8);
	}

	.email-debug-content {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.debug-row {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		font-size: 0.85rem;
	}

	.debug-label {
		color: #71717a;
		min-width: 80px;
		flex-shrink: 0;
	}

	.debug-row code {
		font-family: "JetBrains Mono", monospace;
		background: rgba(0, 0, 0, 0.3);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		color: #a1a1aa;
		word-break: break-all;
	}

	.success-text {
		color: #4ade80;
	}

	.error-text {
		color: #f87171;
	}

	.error-row {
		background: rgba(239, 68, 68, 0.1);
		padding: 0.5rem;
		border-radius: 4px;
		margin-top: 0.25rem;
	}

	.error-details-pre {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.75rem;
		background: rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		border-radius: 4px;
		color: #f87171;
		white-space: pre-wrap;
		word-break: break-all;
		margin: 0;
	}

	/* 반응형 */
	@media (max-width: 480px) {
		.app {
			padding: 1rem;
		}

		.main {
			padding: 1.5rem;
		}

		.upload-zone {
			padding: 2rem 1rem;
		}

		.info-grid {
			grid-template-columns: 1fr;
		}

		.search-summary {
			flex-direction: column;
			gap: 1rem;
		}

		.result-meta {
			flex-direction: column;
			gap: 0.75rem;
		}

		.results-table th,
		.results-table td {
			padding: 0.5rem 0.4rem;
			font-size: 0.8rem;
		}

		.results-table .col-num {
			width: 35px;
		}

		.results-table .col-code {
			width: 65px;
		}

		.results-table .col-business {
			width: 110px;
		}

		.logo {
			flex-direction: column;
			gap: 0.5rem;
		}

		.logo-text {
			text-align: center;
		}

		.connection-header {
			flex-direction: column;
			gap: 0.75rem;
			align-items: stretch;
		}

		.test-btn {
			justify-content: center;
		}

		.test-btn-group {
			flex-direction: column;
		}

		.debug-row {
			flex-direction: column;
			gap: 0.25rem;
		}

		.debug-label {
			min-width: auto;
		}

		.product-code-input {
			font-size: 1.25rem;
		}
	}
</style>
