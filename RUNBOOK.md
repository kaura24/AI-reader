# 제휴코드 추출기 운영 가이드 (RUNBOOK)

## 목차
1. [개요](#개요)
2. [필수 환경변수](#필수-환경변수)
3. [로컬 개발 환경 설정](#로컬-개발-환경-설정)
4. [Vercel 배포](#vercel-배포)
5. [문제 해결 가이드](#문제-해결-가이드)
6. [아키텍처 설명](#아키텍처-설명)

---

## 개요

이 앱은 이미지에서 **특정 제휴코드를 찾아 같은 행의 사업자번호를 추출**하고, 결과를 CSV로 생성하여 이메일로 발송하는 ONE-TIME 처리 시스템입니다.

### 핵심 기능
1. 사용자가 **대상 제휴코드** 입력
2. 이미지 업로드 (제휴코드-사업자번호 매핑 테이블 이미지)
3. OpenAI가 이미지에서 해당 제휴코드를 찾아 **같은 행의 사업자번호 추출**
4. 결과 CSV를 **kaura24@kbfg.com**으로 이메일 발송

### 기술 스택
- **프론트엔드**: SvelteKit 5 + TypeScript
- **백엔드**: SvelteKit Server Routes
- **배포**: Vercel
- **LLM**: OpenAI GPT-4o-mini
- **이메일**: Resend

---

## 필수 환경변수

| 변수명 | 필수 | 기본값 | 설명 |
|--------|------|--------|------|
| `OPENAI_API_KEY` | ✅ | - | OpenAI API 키 |
| `OPENAI_MODEL` | ❌ | `gpt-4o-mini` | 사용할 OpenAI 모델 |
| `OPENAI_ORGANIZATION_ID` | ❌ | - | OpenAI 조직 ID |
| `OPENAI_PROJECT_ID` | ❌ | - | OpenAI 프로젝트 ID |
| `RESEND_API_KEY` | ✅ | - | Resend API 키 |
| `SENDER_EMAIL` | ✅ | - | 발신 이메일 주소 |
| `AFFILIATE_CODE_REGEX` | ❌ | `^\d{6}$` | 제휴코드 검증 정규식 |
| `AFFILIATE_CODE_MIN_CONFIDENCE` | ❌ | `0.6` | 최소 인식 신뢰도 (0.0~1.0) |
| `MOCK_LLM` | ❌ | `false` | LLM 모킹 모드 (개발용) |

> ⚠️ **주의**: `RECIPIENT_EMAIL`은 코드에서 `kaura24@kbfg.com`으로 고정되어 있습니다.

---

## 로컬 개발 환경 설정

### 사전 요구사항
- Node.js 20+
- npm 또는 pnpm

### PowerShell에서 설정

```powershell
# 1. 저장소 클론 및 이동
cd "C:\Gdrive\VIBE_class\AI reader"

# 2. 의존성 설치
npm install

# 3. 환경변수 파일 생성
# .env 파일을 생성하고 아래 내용을 입력하세요
@"
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
SENDER_EMAIL=noreply@yourdomain.com
"@ | Out-File -Encoding utf8 .env

# 4. 개발 서버 실행
npm run dev

# 5. 브라우저에서 접속
# http://localhost:5173
```

### Mock 모드로 테스트

LLM API 없이 테스트하려면 `.env`에 다음을 추가:

```env
MOCK_LLM=true
```

Mock 모드에서는:
- 사업자번호: `123-45-67890` (고정)
- 신뢰도: 0.95 (고정)
- OpenAI API 호출 없음

### API 연결 테스트

UI에서 "연결 테스트" 버튼을 클릭하면:
1. OpenAI Models API를 호출하여 연결 상태 확인
2. 응답 헤더에서 x-request-id, processing-ms 등 메타데이터 표시
3. 구성된 모델명 표시

---

## Vercel 배포

### 최초 배포

```powershell
# 1. Vercel CLI 설치
npm install -g vercel

# 2. 로그인
vercel login

# 3. 프로젝트 초기화 및 배포
vercel

# 4. 환경변수 설정 (대화형)
vercel env add OPENAI_API_KEY
vercel env add RESEND_API_KEY
vercel env add SENDER_EMAIL
```

### 환경변수 설정 (Vercel 대시보드)

1. [Vercel Dashboard](https://vercel.com) 접속
2. 프로젝트 선택
3. Settings → Environment Variables
4. 각 변수 추가 (Production/Preview/Development 구분 가능)

### 재배포

```powershell
# 프로덕션 배포
vercel --prod

# 프리뷰 배포
vercel
```

---

## 문제 해결 가이드

### HTTP 400: missing_target_code

**증상**: "대상 제휴코드를 입력해주세요."

**해결**: 대상 제휴코드 입력 필드에 값을 입력하세요.

---

### HTTP 400: invalid_target_code

**증상**: "제휴코드 형식이 올바르지 않습니다."

**원인**: 입력한 제휴코드가 정규식과 불일치 (기본: 6자리 숫자)

**해결**:
1. 올바른 형식의 제휴코드 입력
2. `.env`에서 `AFFILIATE_CODE_REGEX` 수정
   - 예) 8자리 영숫자: `^[A-Z0-9]{8}$`

---

### HTTP 413: Payload Too Large

**증상**: 이미지 업로드 시 "payload too large" 에러

**해결**: 더 작은 이미지 사용 (자동 압축이 4.2MB로 제한)

---

### HTTP 422: extraction_failed

**증상**: "이미지에서 제휴코드 'XXX'에 매핑된 사업자번호를 찾을 수 없습니다."

**원인**:
- 이미지에 해당 제휴코드가 없음
- 이미지 품질이 너무 낮음
- 제휴코드-사업자번호 매핑이 같은 행에 없음

**해결**:
1. 이미지에 입력한 제휴코드가 있는지 확인
2. 고해상도 이미지 사용
3. 테이블 형식으로 정렬된 이미지 사용

---

### HTTP 422: low_confidence

**증상**: "사업자번호 인식 신뢰도가 너무 낮습니다"

**해결**:
1. 더 선명한 이미지 사용
2. `.env`에서 `AFFILIATE_CODE_MIN_CONFIDENCE` 조정 (예: 0.5)

---

### HTTP 429: Rate Limit

**증상**: OpenAI API 요청 제한 초과

**해결**: 잠시 대기 후 재시도 (자동 재시도 내장)

---

### 이메일 발송 실패

**증상**: `emailed: false` 응답

**해결**:
1. Resend 대시보드에서 도메인 인증 확인
2. `SENDER_EMAIL`이 인증된 도메인인지 확인

> 📧 수신자 이메일은 `kaura24@kbfg.com`으로 고정되어 있습니다.

---

### API 연결 테스트 실패

**증상**: "연결 테스트" 버튼 클릭 시 오류

**해결**:
1. `.env` 파일에서 `OPENAI_API_KEY` 확인
2. OpenAI 대시보드에서 API 키 유효성 확인

---

## 아키텍처 설명

### 처리 흐름

```
[클라이언트]                    [서버]                      [외부 서비스]
    │                            │                              │
    │ 1. 대상 제휴코드 입력       │                              │
    │ 2. 이미지 선택              │                              │
    │ 3. 클라이언트 압축          │                              │
    │    (4.2MB 이하로)          │                              │
    ├────────────────────────────>│                              │
    │                            │ 4. 크기 검증 (<4.5MB)        │
    │                            │ 5. 제휴코드 형식 검증        │
    │                            │                              │
    │                            │ 6. OpenAI 호출 ──────────────>│ OpenAI
    │                            │    "제휴코드 XXX를 찾아서    │
    │                            │     같은 행의 사업자번호     │
    │                            │     추출해줘"               │
    │                            │<─────────────────────────────│
    │                            │                              │
    │                            │ 7. 결과 검증                 │
    │                            │ 8. CSV 생성                  │
    │                            │                              │
    │                            │ 9. 이메일 발송 ──────────────>│ Resend
    │                            │   (kaura24@kbfg.com)        │
    │                            │<─────────────────────────────│
    │                            │                              │
    │<────────────────────────────│ 10. JSON 응답               │
    │                            │                              │
```

### AI 프롬프트 구조

```
이미지에서 제휴코드 "{targetCode}"를 찾고, 
해당 제휴코드와 같은 행(row)에 있는 사업자번호를 추출하세요.

- 제휴코드를 정확히 찾으세요
- 같은 행의 사업자번호를 추출하세요
- JSON 형식으로만 응답하세요

{
  "affiliate_code": "{targetCode}",
  "business_no": "추출된 사업자번호",
  "confidence": 0.0~1.0
}
```

### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/test-connection` | OpenAI API 연결 테스트 |
| POST | `/api/process-once` | 대상 제휴코드로 사업자번호 추출 |

### 디렉토리 구조

```
src/
├── lib/
│   ├── client/
│   │   └── imageShrink.ts     # 클라이언트 이미지 압축
│   ├── email/
│   │   └── resend.ts          # Resend 이메일 발송
│   ├── extract/
│   │   └── affiliateCode.ts   # 사업자번호 추출 로직 + 프롬프트
│   ├── llm/
│   │   └── openai.ts          # OpenAI Responses API
│   ├── output/
│   │   └── csv.ts             # CSV 생성
│   └── util/
│       └── env.ts             # 환경변수 검증
└── routes/
    ├── +page.svelte           # 메인 UI (대상 제휴코드 입력 포함)
    └── api/
        ├── test-connection/
        │   └── +server.ts     # API 연결 테스트
        └── process-once/
            └── +server.ts     # 사업자번호 추출 API
```

---

## 가정 사항

1. **이미지 형식**: 제휴코드와 사업자번호가 테이블 형태로 같은 행에 위치
2. **Vercel Functions 제한**: 4.5MB 페이로드 제한 준수
3. **LLM**: OpenAI `gpt-4o-mini` 사용
4. **이메일 서비스**: Resend 사용 (도메인 인증 필요)
5. **수신 이메일**: `kaura24@kbfg.com` (코드에 고정)
6. **제휴코드 기본 형식**: 6자리 숫자 (환경변수로 변경 가능)

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2026-01-17 | 1.0.0 | 최초 작성 |
| 2026-01-17 | 1.1.0 | 대상 제휴코드 입력 기능 추가, AI가 이미지에서 직접 사업자번호 추출 |
