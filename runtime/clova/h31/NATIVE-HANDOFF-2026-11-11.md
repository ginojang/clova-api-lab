# Elda native CLOVA 인계 — 2026-11-11

대상은 코딩고래 소유 Elda CLI ② native loop다. 이번 확인은 설치 소스 읽기·기존 H31 증거 재검토·메모리 내 모의 호출뿐이다. 설치 CLI 수정, 운영 명령, 실제 모델 호출은0회다. H31 재측정이나 Graph/Pi 개선을 요청하는 목록이 아니다.

## 이미 확인된 사항

- **숫자 text42는 이미 시험했다.** [최종 malformed 원문](../results/h31-malformed-schema-final-2026-11-11.json)의 `harness=elda, case=numeric_text`는 원시42 유지, `wrong_type/text`, `retryable:true`, `sideEffect:not_started`, 승인0회·파일0개다. 이어진 모델 요청도 이 진단을 받았다. 수정 전·중간·최종 비교에서 동일했다. 이는 모의 CLOVA 응답을 실제 설치 native loop에 통과시킨 시험이며, 실제 HCX가 숫자42를 생성했다는 뜻은 아니다.
- native는 [2차 실제 비교](RESULT-2026-11-11.md) 과제4/4와 [공식 키트](kit-README.md) FAIL0/WARN0을 기록했다. Graph/Pi의 H47/H48/H53 경고를 native 결함으로 옮기지 않는다.
- **Retry-After 처리는 이미 있다.** 제공자 자체는 재시도0회, `LoopAdapter`가 일시 오류·도구 호출 전·턴당1회만 재시도한다. 숫자 초 형식의 Retry-After를 사용하며60초를 넘으면 재시도하지 않는다. 헤더가 없으면 `ELDA_RETRY_DELAY`, 기본2초다. 날짜 형식은 현재 무시한다. 근거: `providers/__init__.py:59`, `providers/clova.py:193`, `adapters/loop.py:305`.

## 인계할 결함·판단 요청

| 구분 | 재현·현재 동작 | 요청 |
| --- | --- | --- |
| 재현됨: 본문 오류 경로의 Retry-After 누락 | HTTP429 + body42901 + Retry-After7 → `rate_limit`, `retry_after=7.0`. HTTP200 + body42901 + 같은 헤더 → `rate_limit`, `retry_after=None`. 성공 HTTP 응답의 헤더를 보관하지 않아 루프 기본2초 대기로 떨어진다. | `Clova.complete()`의 HTTP200/서비스 실패 경로에도 헤더를 전달하고, 두 경로의 동등성 회귀를 추가한다. `Retry-After>60`이면 재시도하지 않는 경계는 유지한다. |
| 재현됨: 40080 분류·구조화 코드 차이 | HTTP200/body40080은 native `status=400, kind=invalid_request`. 랩 `clovaBodyFault()`는 `model_not_found`로 분류한다. NAVER 코드는 예외 메시지 안에만 있고 별도 구조 필드가 없다. | [H20+ 랩 계약](../H20-CYCLE4-RESULT-2026-11-11.md)과 대조해 40080 분류 및 구조화 providerCode 전파를 결정한다. 공급자 자유 텍스트를 확대 노출하는 방식으로 해결하지 않는다. |
| 재현됨: 빈 properties의 알 수 없는 필드 | `diagnose({unexpected:true}, {type:object,properties:{},additionalProperties:false})`가 None을 반환한다. `if props` 조건 때문에 인자 없는 도구의 추가 필드를 승인 전 단계에서 놓친다. | 빈 properties에서도 additionalProperties:false를 지키는 회귀를 추가한다. 이 확인은 diagnose 함수 모의 검사이며 실제 도구 효과가 발생했다는 주장은 아니다. 일반적인 중첩·enum·범위 제약은 현재 윗단 검사 범위 밖이다. |
| 판단 요청: 계정/프로세스 간 속도 조절 | 첫 H31 실제38호출 중429/42901이4회였다. 다음 라운드의 정상 응답 헤더에서60req/min·60,000tok/min을 관측했다. 다른 계정 작업을 통제하지 않아 429 원인을 우리 호출 속도로만 단정할 수 없다. | 실제 Task에서 요청·토큰 잔량/reset/Retry-After를 관찰하고 공통 대기 또는 스케줄 분산이 필요한지 판단한다. 호출마다 고정6초 대기를 운영 표준으로 채택할 근거는 없다. 재시도 횟수를 무작정 늘리지 않는다. |

위 재현은 `Clova._key`와 `urllib.request.urlopen`을 메모리에서 mock했다. HTTP 오류와 HTTP200 본문 오류 모두 `status.code=42901`, `Retry-After:7`을 사용했다. 결과는 각각 `429/rate_limit/7.0/true`, `429/rate_limit/None/true`였다. `40080`은 `400/invalid_request/None/false`였다. 실제 키를 읽거나 네트워크 요청을 보내지 않았다.

기존 숫자 인자 시험을 재현해야 할 때는 이 저장소에서 새 출력 경로로 아래 명령을 사용한다. 세 실행기의18사례 회귀이며 유료 API를 호출하는 옵션은 없다. 이미 있는 결과로 충분하므로 인계를 위해 다시 실행할 필요는 없다.

```bash
node runtime/clova/h31/malformed.mjs --output .local/new-native-argument-check.json
```

## 소스 식별과 관측 한계

추가 수신 `381c4a52dc`와 [Elda-Spec b888f05 키트 기록](https://github.com/ginojang/Elda-Spec/blob/b888f05a36d4310ffbbccb6bb81f9d68013f44f7/harness/kit/README.md)을 읽었다. 새 kit0.808/harness0.809는 CLI4696537 + Ops9731339에 FAIL2/WARN1을 기록했다. **H57 notify의 origin.kind=human을 사람 입력처럼 취급하는 경로는 코딩고래에게 추가 인계**한다. 현재 설치 `events.py:327`에도 이 분기가 있다. 거절하거나 비인간 알림으로 감싸는 처리가 필요하다. H61 feed_read/resource 누락은 Ops의 인프라 몫이다. 이 랩은 새 키트를 직접 실행하지 않았으며, 앞선 kit0.805의 FAIL0/WARN0과 섞어 적합성을 주장하지 않는다.

이번 읽기 시 설치 CLI HEAD는 `469653789ca820f8919bb43477e14fefe37eb281`이었다. 다음 해시는 최종 malformed 결과의 native 소스와 같다. 저장소 HEAD만으로 실험 당시 모든 설치 파일이 같았다고 추정하지 않고 파일별로 대조했다.

| 설치 파일 | 이번 SHA-256 |
| --- | --- |
| providers/clova.py | `c021eaa3bc41a9180207693248c704eeaacd4c36f84296c6e1024f2be1f2a8f6` |
| providers/__init__.py | `fa58618e5453b03e02f768c5f9f606f0cdff944659ccb7e6ea0d9c94b9962f20` |
| adapters/loop.py | `ef06a04b7c4e6b2f05b6b77963c27cf556ff5d1fa761adb201bd13d1ad31eab4` |

이번 목록은 실제 운영 Task를 막는 결함으로 일괄 분류하지 않는다. 도구 없는 `host-watch-explain`의 첫 실행은 별도 운영 경로·응답 근거·사용량 검증이며, 위 모의 오류 경계는 코딩고래가 자신의 저장소에서 수정·회귀할 범위다. 실측에서429가 다시 발생하면 해당 실행을 실패로 보존하고 보고된 대기값·입력/출력 사용량·누락 여부를 함께 기록한다.
