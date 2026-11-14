# R1부터 R7까지의 서빙 관문 접근 감사

2026-11-14의 **역할 변경 전 관측 기록**이다. 당시 hellcat의 SSH 루프백 경로로 health와 모델 목록을 읽었다. 현재 사용자 결정으로 클로버의 내부 관문 접근은 금지됐으며 무료 health/models 조회도 포함한다(`753b9bfc98`, `bc4c03b8bb`). 실제 모델 생성 호출은 0회다. 따라서 API 계정 한도·실제 추론 성공·실제 청구액까지 검증한 것은 아니다. 키 값 조회·복사, 원격 파일 수정, 서비스 재시작은 하지 않았다.

후속 사용자 지시 **“외부 API 쓰지 말고 리서치만”** 이후에는 추가 health/models 조회도 중단했다. 아래는 그 전에 관측한 사실과 문헌·소스 검토 결과다. 접근 개설·공급자 계수 호출·모델 실험을 진행하라는 청구가 아니다.

## 관측한 판과 범위

| 대상 | 직접 확인한 값 | 해석 범위 |
|---|---|---|
| hellcat 관문 | `http://127.0.0.1:3300`, `/healthz` HTTP 200, version `0.1.0`, commit `e479e437`, price_ver `859cf74d` | 실행 중인 관문이 보고한 빌드 정보 |
| 공급자 상태 | `anthropic: ready`, `degraded: null` | 키 설정·현재 알려진 거부 상태에 관한 health 정보. 이번에 공급자 생성 요청으로 키를 확인한 것은 아님 |
| 관문 모델 목록 | `/v1/models` HTTP 200 | `small → claude-haiku-5-5`, `judge → claude-sonnet-5-5`, `judge-hard → claude-opus-5-5`, `giant → gpt-6-sol` |
| 관문 프로세스 | active, 시작 `2026-11-13 17:02:21 KST` | 읽기 전용 systemd 상태 |
| 오케 프로세스 | active, 시작 `2026-11-14 18:49:58 KST`, `/healthz` HTTP 200 | 해당 시점의 재시작과 health만 확인 |
| 오케 배포 파일 | `/home/gino/apps/elda/elda-orchestrator/dist/router/v1_0/turn.js`에 `x-elda-persona`, `persona_rev` 코드 존재 | persona 헤더 수정이 배포 파일에 있음. 실제 persona 턴을 보내 동작을 검증하지는 않음 |

공유 참조 저장소는 감사 중 갱신됐다. 첫 확인의 GanpanAI HEAD는 `0ddbc321c9fc435cf3149b4287ca10f2d9dbe32c`였고, 마지막 소스 확인은 `a2409c69`(2026-11-14 18:58:41 KST), Elda-Spec은 `980527af7eb118bbdf20bd540021afc028bd0309`(18:57:31 KST)였다. 이 문서 이후의 변경은 반영하지 않는다.

## 접근과 자격 증명

실행 중인 관문 `.env`에서 비밀이 아닌 설정만 확인했다. `PROXY_HOST=127.0.0.1`, `PROXY_PORT=3300`이며 `GATEWAY_TOKEN_FILE`은 설정되지 않았다. 관문 코드는 루프백 접속을 토큰 없이 받고, 비루프백 접속에는 관문 토큰을 요구한다. 현재 로컬 pluto의 CLOVA 키는 이 관문의 자격 증명이 아니다.

이전 확인은 기존 SSH 별칭 `hellcat`으로 접속한 GET 조회였다. 당시 기술적으로 도달했다는 사실과 현재 사용 권한은 다르다. 실행 경로 제안은 철회됐으며 이 문서는 재접속 안내가 아니다. 이후 실측은 사용자가 정한 별도 실행 담당자의 몫이다.

## 실험 파라미터의 제약

근거는 GanpanAI `elda-proxy/src/routes/gateway.ts`, `src/providers/anthropic.ts`이며, 관문 경로의 소스와 배포 JS에서 확인했다.

| 항목 | 현재 구현 | R1부터 R7까지에 주는 제약 |
|---|---|---|
| 두뇌 선택 | `small`과 `judge` 등급을 실제 모델로 해석 | 요청 등급과 응답 `model`을 둘 다 기록한다. 실제 서빙 등급을 쓰고 HCX는 비교 열로만 둔다. |
| 표본 다양성 제어 | `temperature`, `top_p`, `seed`는 Anthropic 관문의 지원 목록에 없음 | 기존 HCX의 `temperature:0` 설정을 그대로 옮기면 안 된다. 허용되는 설정을 고정하고 3회 반복의 분산을 관측한다. |
| 생각 정도 | 기본 `low`; `reasoning_effort` 지원. Haiku의 `none`과 Sonnet의 `none`은 공급자 변환 방식이 다름 | 디코더와 판정자 설정을 별도로 사전 등록한다. 임의로 `none`으로 낮춰 같은 서빙 조건이라고 부르지 않는다. |
| 출력 상한 | `max_tokens` 또는 `max_completion_tokens`; 생략 시 기본 16,000 | 모든 연구 요청에 명시적 상한이 필요하다. |
| native 구조화 출력 | 외부 관문은 `response_format`을 거절. 내부 호환 경로는 이를 제거하고 로그에 남김 | R3의 프롬프트 기반 네 필드 계약과 native JSON Schema 강제는 다른 처치다. 내부 경로로 보내 성공했다고 native SO가 적용됐다고 볼 수 없다. |
| 강제 도구 선택 | Haiku에서는 지원하지만 생각을 끄는 부수 변경이 있음. Sonnet·Opus에서는 거절 | 도구 강제를 R3 대용으로 사용하면 계약 이외 변인도 바뀐다. |
| 토큰 수 세기 | 관문 라우터 및 배포 JS에 `count_tokens`/`countTokens` 경로 없음 | R1의 100/200/400/800을 공급자 기준 블록 토큰 수로 정확히 맞추려면 별도 계수 경로가 필요하다. |
| 재시도 | Anthropic SDK `maxRetries:0` | 연구 실행기의 재시도 정책·최초 실패·추가 호출을 별도로 기록한다. |

## 토큰과 비용의 의미

관문 응답의 `usage.elda_usage`는 네 칸을 보존한다.

```text
input      = 캐시 밖 입력
cacheRead  = 캐시 읽기 입력
cacheWrite = 캐시 생성 입력
output     = 출력
prompt_tokens = input + cacheRead + cacheWrite
```

따라서 블록 유/무 차분에서 `input`만 빼면 캐시 상태의 차이를 블록 길이로 오해할 수 있다. 전체 입력을 합산하더라도 얻는 것은 두 요청의 **증분 입력 토큰**이다. 메시지 프레이밍, 조립 위치, 인접 텍스트에 따른 토큰화 차이가 있어 독립된 persona 블록의 정확한 토큰 수와 같다고 단정할 수 없다. 공급자 토큰계수 API를 관문에서 지원받거나, 이 증분량 자체를 실험 변수로 명시하는 설계 변경이 필요하다.

관문 `/models`에는 가격 네 칸이 없고 `proxy.call_log`의 내부 레인 비용은 `null`이다. `price_ver=859cf74d`는 가격표 버전 표지이며 모든 모델의 가격을 제공한다는 뜻은 아니다. 실제 `elda-proxy/data/openai_price_usd_per_1m.json`은 `scope: GIANT only`, `models:{}`다. 비용 `null`을 0원으로 해석하지 않는다.

별도 입구의 계산표는 Elda-AI-Agent `mini-api/src/lib/modelPrices.ts`에 있다. 해당 파일 변경 커밋은 `7dbc710`(2026-11-09), 감사 시 저장소 HEAD는 `e47fd68ada3435e75467abc32da681488cb02abd`였다.

| 내부 계산표, USD/100만 토큰 | input | output | cacheRead | cacheWrite |
|---|---:|---:|---:|---:|
| claude-haiku-5-5 | 0.1 | 0.5 | 0.01 | 0.125 |
| claude-sonnet-5-5 | 2 | 10 | 0.2 | 2.5 |

이는 저장소에 설정된 계산표다. 이번 감사에서 공급자 청구서나 공식 최신 공시가와 대조하지 않았으므로 실험 비용에 쓰려면 **이 표를 사용하는 추정액**임을 표시하고 가격 기준의 승인을 받아야 한다. 관문 실제 청구액이라고 표시하지 않는다. 계정 월 한도와 연구 예산은 이번 health 조회로 알 수 없다.

## persona 배선의 새 변경과 남은 확인

- `0ddbc321`: `x-elda-persona: <id>@<rev>`를 먼저 읽고, 없으면 `body.persona`를 읽어 `/chat`으로 넘긴다. 해당 단계의 rev는 로그용이며 실제 persona는 DB 현재 판으로 해석한다. 배포 파일과 오케 재시작은 위 표의 범위에서 확인했다.
- `2a163715`: `personaBlock.ts`와 `PERSONA_BLOCK=shadow` 기본값, `on`일 때 세션 첫 턴·블록 변경 턴의 주입, 약 300토큰 예산을 추가했다. **토큰은 추정치**다.
- `7f0701d5`·`a2409c69`: `HARNESS_DIAG=on`일 때 persona·md5와 `block_md5`, `fresh`, `block_emitted`를 `hookSpecificOutput.diag`에 싣는다. Elda-Spec `980527a`는 하네스 v1.001과 `turn_end.diag.hook`을 정의한다.
- **뒤의 shadow·diag 변경은 소스만 확인했다.** 실제 운영 배포·설정 활성·턴 결과는 이번에 검증하지 않았다. v1.000 파일럿의 근거를 새 v1.001의 실행 결과로 소급하지 않는다.
- 확인한 Elda-Spec `harness/template/src/hooks.ts`와 Core `harness/executor/src/hooks.ts`는 HTTP 호출에서 `content-type`만 넣으며 설정의 임의 `headers` 필드를 전달하지 않는다. 따라서 파이프라인 초안의 “Elda CLI·틀 둘 다 훅 headers 지원”은 **확인한 템플릿 소스와 맞지 않는다**. Elda CLI 지원 여부와 별도로 실제 소비 실행기별 전송을 검증해야 한다.

## 연구 설계에 남은 정보

1. 연구 실행 위치/접속 경로, 레인과 `measured:ruler`, 검증용 cid 규칙, 동시성·초당 호출 한도.
2. small/judge 호출 예산과 허용 비용, 비용 추정에 사용할 가격표의 출처·판.
3. R1의 공급자 토큰계수 경로 또는 증분 입력 토큰을 처치 크기로 쓰는 설계 합의.
4. R3이 프롬프트 네 필드 계약인지 native 스키마 강제인지의 정의. 후자는 현재 관문 확장이 필요하다.
5. 실제 실험에 고정할 persona rev/블록과 v1.001 소비 실행기·헤더 전송·diag 동작의 확인.

**이번 감사로 결정할 수 있는 것:** 기존 HCX 실행기를 파라미터만 바꿔 R1부터 R7까지 바로 돌리는 방식은 사용할 수 없다. 토큰 크기 정의·출력 계약 지원·연구 예산은 설계상 미정 조건으로 남긴다. 현재 작업은 조사 범위이며 추가 API 실행이나 접근 개설을 진행하지 않는다.
