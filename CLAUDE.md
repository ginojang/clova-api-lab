# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(및 기타 에이전트)를 위한 지침이다.

## 프로젝트 개요 (확장됨, 2026-05-29)

**clova-api-lab** — 원래 CLOVA Studio API 데모 콘솔로 출발했으나, 현재는 **거인 AI API + 우리 자체 AI(ELDA) 통합 테스트·벤치·분석 허브**로 확장됐다. 세 가지 역할:

1. **거인 API 매트릭스 테스트**: CLOVA Studio, OpenAI, Anthropic Claude, Google Gemini, DeepSeek, GLM, Qwen, Ollama 로컬 등을 **동일 벤치(모델×프롬프트 셀 캐시)**로 비교. 응답 품질·지연·토큰·지시준수.
2. **자체 ELDA 테스트**: GanpanAI **MY-LLM Architecture(Intenter→Reasoner→Decoder, [GanpanAI/MY-LLM Architecture v2.2.md](../GanpanAI/MY-LLM%20Architecture%20v2.2.md))**의 헤드리스 추론 서비스(`ai-apistack`/`elda-orchestrator`)를 외부 클라이언트로 호출해 거인들과 동일 잣대로 평가.
3. **모델 포렌식 + 멀티모달 R&D**: 가중치/토크나이저 출처 분석(`analysis/`)과 자체 멀티모달 구축 설계(`multimodal/`)의 허브.

핵심 흐름:
```
[API Key·세션] → [Provider/모델 선택] → [파라미터·프롬프트] → [호출 — 거인 또는 ELDA]
                                                  → [Bench 매트릭스 적재·Claude 평가] → [포렌식·분석 보고서]
```

> 원본 문서: `시작문서.md` (초기 CLOVA 단독 시점 기획). 구현·범위는 본 CLAUDE.md가 우선. 관련 디렉토리:
> - [`analysis/`](analysis/) — 모델 출처 포렌식(LLM·Vision·Audio 가중치 비교) + 재현 스크립트
> - [`multimodal/`](multimodal/) — 자체 멀티모달(지각 프론트엔드) 시작 설계서
> - 외부: `GanpanAI/` (hellcat 공유) — MY-LLM·Image Pipeline·Intent 등 ELDA 아키텍처 원본

## 아키텍처 (가장 중요)

프론트에서 CLOVA API를 **직접 호출하지 않는다.** 반드시 중간 백엔드 프록시를 경유한다.

```
React Front  →  Local Proxy API (Node/Express)  →  CLOVA Studio API
```

프록시를 두는 이유:
- **API Key 노출 방지** (프론트 번들에 키가 들어가면 안 됨)
- CORS 회피
- 요청/응답 로그 저장
- 모델별 어댑터 통일
- 추후 OpenAI/Ollama/Qwen/Claude 비교

### Provider Adapter 구조

거인 API + 자체 ELDA를 **동일 인터페이스**로 호출하는 어댑터 패턴:

```
ProviderAdapter
  ├─ clovaLegacyAdapter      (X-NCP-* 헤더, 구버전)
  ├─ clovaBearerAdapter      (Bearer v3 — 현행, HCX-005 등)
  ├─ clovaOpenAIAdapter      (CLOVA OpenAI 호환 엔드포인트)
  ├─ openaiAdapter           (OpenAI Chat Completions / Responses)
  ├─ anthropicAdapter        (Claude Messages API)
  ├─ geminiAdapter           (Google Gemini)
  ├─ deepseekAdapter         (DeepSeek Chat — OpenAI 호환)
  ├─ glmAdapter              (智谱 GLM)
  ├─ qwenCloudAdapter        (DashScope/통의천문 API)
  ├─ ollamaAdapter           (로컬 — qwen2.5/qwen3/phi4/bge-m3 등)
  └─ eldaAdapter             (우리 자체 — ai-apistack/orchestrator 헤드리스 추론)
```

```ts
export type AiProvider =
  | 'clova' | 'clova-openai'
  | 'openai' | 'anthropic' | 'gemini'
  | 'deepseek' | 'glm' | 'qwen'
  | 'ollama'
  | 'elda';

export type UnifiedChatRequest = {
  provider: AiProvider;
  model: string;                         // ELDA는 모델 대신 파이프라인 식별자
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
};
```

> 인증·rate-limit·세션 격리는 각 어댑터가 흡수. ELDA는 [GanpanAI MY-LLM Architecture §4 API-first](../GanpanAI/MY-LLM%20Architecture%20v2.2.md)에 따라 `X-Api-Key`(scope `inference`) + `key_id:conversation_id` 복합 세션키로 호출한다.

### 확장 역할 — 기존 코드/툴 매핑

| 역할 | 무엇을 하나 | 이 저장소의 실체 | 외부 의존 |
|---|---|---|---|
| ① 거인 API 매트릭스 테스트 | 같은 프롬프트를 N개 provider×model에 돌려 응답/지연/토큰/지시준수 비교 | **Bench 콘솔** (`server/bench/`, `src/components/BenchPanel.tsx`) — `bench_cell(model, prompt_id)` 셀 캐시 + Claude 평가 | MySQL `clova_lab`(spitfire), hellcat claude CLI |
| ② ELDA 자체 테스트 | GanpanAI 파이프라인을 외부 클라이언트로 호출(거인들과 동일 잣대) | `eldaAdapter` 신설 후 같은 Bench가 그대로 적용됨. 모델 필드 = 파이프라인 식별자 | `ai-apistack`/`elda-orchestrator` 게이트웨이 |
| ③ 모델 출처 포렌식 | 가중치 코사인·토크나이저 지문·출력 비교로 모델 계보 추적 | [`analysis/`](analysis/) — LLM·Vision·Audio 보고서 + 재현 스크립트. 프론트 탭(LLM/Vision/FSM-분석)에서 렌더 | hanaki(`~/tokenv` venv), HF 모델 캐시, ollama 후보 모델 |
| ④ 멀티모달 R&D | 자체 멀티모달 = 지각 프론트엔드 설계·PoC | [`multimodal/`](multimodal/) — 시작 설계서(MY-LLM 정합). 진입점 A(이미지 임베딩→RAG)→B(공간지각)→C(VQA) | hanaki RTX 5060 Ti(16GB), `~/mmenv`(cu128 torch) 예정 |

> 프론트 탭 구성: **Bench / LLM-분석 / Vision-분석 / FSM-분석 / Chat** (`src/components/Layout.tsx`).

## 기술 스택

- **Front**: Vite + React + TypeScript + Tailwind CSS
- **Proxy 서버**: Node + Express + TypeScript

## 디렉토리 구조 (계획)

```
clova-api-lab/
  package.json
  vite.config.ts
  .env.example
  src/
    main.tsx
    App.tsx
    components/
      Layout.tsx
      ApiKeyPanel.tsx
      ModelSelector.tsx
      ChatTester.tsx
      CompletionTester.tsx
      EmbeddingTester.tsx
      SkillTester.tsx
      RequestViewer.tsx
      ResponseViewer.tsx
      LogPanel.tsx
    api/
      clovaClient.ts
      proxyClient.ts
    types/
      clova.ts
      apiLog.ts
    store/
      useClovaStore.ts
  server/
    index.ts
    routes/
      clova.ts
      health.ts
    services/
      clovaService.ts
    types/
      clova.ts
```

## 환경 변수

`.env.example` 기준:

```
VITE_API_BASE=http://localhost:3600

CLOVA_API_KEY=
CLOVA_APIGW_API_KEY=
CLOVA_BASE_URL=https://clovastudio.stream.ntruss.com
PORT=3600
```

- `VITE_API_BASE`: 프론트가 호출할 로컬 프록시 주소.
- `CLOVA_*`: **server/.env 에서만 사용.** 프론트 번들에 절대 포함하지 않는다.

## 백엔드 프록시 API 설계

### `GET /health`
```json
{ "ok": true, "service": "clova-api-lab", "time": "2026-05-23T00:00:00.000Z" }
```

### `POST /api/clova/chat`
Request:
```json
{
  "model": "HCX-003",
  "messages": [
    { "role": "system", "content": "너는 테스트용 AI다." },
    { "role": "user", "content": "안녕?" }
  ],
  "temperature": 0.7,
  "topP": 0.8,
  "maxTokens": 512,
  "stream": false
}
```
Response:
```json
{
  "ok": true,
  "provider": "clova",
  "model": "HCX-003",
  "content": "...",
  "raw": {},
  "latencyMs": 1234
}
```

### `POST /api/clova/chat/stream`
SSE 방식으로 프론트에 전달:
```
event: token
data: {"text":"안"}

event: done
data: {"ok":true}
```

## CLOVA 호출 어댑터 (legacy)

`server/services/clovaService.ts` 의 핵심. CLOVA Studio 기존 API는 다음 헤더를 사용한다:

- `X-NCP-CLOVASTUDIO-API-KEY` ← `CLOVA_API_KEY`
- `X-NCP-APIGW-API-KEY` ← `CLOVA_APIGW_API_KEY`

엔드포인트 형태:
```
${CLOVA_BASE_URL}/testapp/v1/chat-completions/${model}
```

> CLOVA Studio는 OpenAI 호환 API도 제공한다(키/엔드포인트/모델명만 교체). `clova-openai` 어댑터로 별도 지원한다.

## 화면 구성 (MVP)

- **좌측 패널**: API Key 상태 / Endpoint Mode / Model / Temperature / TopP / Max Tokens / Streaming ON·OFF / System Prompt
- **중앙 패널**: Chat 입력창 / 메시지 목록 / 실행 버튼 / 스트리밍 출력 영역
- **우측 패널**: Raw Request JSON / Raw Response JSON / Latency / Token usage / Error log / Copy 버튼

## 구현 순서 (Phase / Step)

API 구현 우선순위:
- **Phase 1**: Health Check, Chat Completions, Streaming Chat, OpenAI Compatible Chat
- **Phase 2**: Embedding, 요약/분류 프롬프트 템플릿, JSON Output Test
- **Phase 3**: Skill Trainer, Router, RAG, 모델 비교 모드

작업 순서:
1. Vite + React + TS 프로젝트 생성, Tailwind 적용, 기본 Layout
2. Express 프록시 서버 + `/health` + `.env` 로딩
3. `/api/clova/chat` 구현 + Raw Request/Response 표시
4. Chat UI (System Prompt / User Message / Assistant Response)
5. Streaming (SSE 출력, 중간 token 표시)
6. 로그 패널 (latency / status / model / request / response / error)
7. OpenAI 호환 모드 추가, provider adapter 구조로 정리

## 보안 / 주의사항 (반드시 준수)

- **API Key를 localStorage에 저장하지 않는다.** 테스트 입력 시 session memory만 사용.
- 실제 키는 `server/.env` 에만 둔다. 프론트에 노출 금지.
- 프론트에서 CLOVA API를 직접 호출하지 않는다 (항상 프록시 경유).
- 요청/응답 원문(Raw JSON) 표시는 **개발 중에만.** 프로덕션에서는 로그 마스킹 필요.
- **이 저장소는 public이다.** DB 비밀번호·API Key·터널 자격증명 등 어떤 시크릿도 커밋하지 않는다. 실제 운영 값은 hellcat의 `~/apps/clova-api-lab/.env` 와 로컬 `배포.txt`(gitignore됨)에만 둔다.

## 배포 / 운영 환경

> 자세한 원본은 로컬 `배포.txt`(저장소에 커밋하지 않음). 여기에는 시크릿을 적지 않는다.

자매 프로젝트(elda-agent / GanpanAI)와 **동일한 2-호스트 토폴로지**를 따른다.

```
사용자 → AmazonFront(EC2, nginx)
            ├─ 정적 SPA (dist/ rsync 배포)
            └─ /api/* 리버스 프록시 → 127.0.0.1:<port>
                                        ↑ autossh 역방향 터널
                              hellcat(LAN 192.168.0.28) 의 프록시 데몬
                                        ↓ LAN 직결
                              spitfire(192.168.0.2:5432) PostgreSQL
```

### 호스트 역할

- **AmazonFront (EC2, Amazon Linux 2023, t2.micro·916Mi RAM)**: nginx 정적 SPA + 리버스 프록시 **전용**. 백엔드 데몬 안 띄움.
  - **빌드 금지** — RAM 916Mi라 Vite 빌드 OOM 위험. **항상 로컬에서 `npm run build` 후 `rsync` 로 `dist/` 전송.**
- **hellcat (Rocky Linux 9.6, Node v20)**: 실제 프록시(Express) 데몬 호스트. `~/apps/clova-api-lab/` 슬롯에 배치.
  - 기존 슬롯: punker-api(3000), corpus-api(3100), elda/*(3200·9100~9400), elda-agent(4000). clova-api-lab은 **포트 3600** 으로 같은 패턴으로 들어간다.
  - **autossh 역방향 터널**(`-R 3600:localhost:3600 AmazonFront`)로 EC2 `127.0.0.1:3600` 에 listen.
  - systemd 유닛 2개 쌍: app unit + tunnel unit (elda-agent의 `*-api.service` / `*-api-tunnel.service` 패턴 그대로).
- **spitfire (PostgreSQL 16)**: `192.168.0.2:5432`, LAN 직결. clova-api-lab **전용 DB**를 두고 요청/응답 로그를 영속화한다. 접속 자격증명은 hellcat의 `~/apps/clova-api-lab/.env` 에만 둔다(저장소 금지).

### 배포 흐름 (요지)

```
로컬:  npm run build           # dist/ 생성 (EC2에서 빌드하지 않음)
로컬:  rsync -avz --delete dist/  AmazonFront:/var/www/<path>/
hellcat: 코드 갱신 → sudo systemctl restart clova-api-lab{,-tunnel}  (NOPASSWD 허용 범위)
헬스:  curl -sS http://127.0.0.1:3600/health
```

> HTTPS는 미설정. 도메인 확보 후 Let's Encrypt + certbot.

## 성공 기준

- 로컬에서 `npm run dev` 실행 → 프론트 접속 가능
- 서버 env 또는 입력 키로 CLOVA Chat Completion 호출 성공
- Streaming 출력 성공
- Raw JSON / 에러 메시지 확인 가능
- 요청 로그 누적 가능

## 테스트 프롬프트 기본 세트

일반 한국어 대화 / 존댓말·반말 변환 / 문서 요약 / 감정 분류 / 의도 분류 / JSON 출력 강제 / 코드 생성 / 한국어 문화 문맥 질문 / 긴 문맥 유지 / Qwen·Ollama 비교용 동일 프롬프트.
