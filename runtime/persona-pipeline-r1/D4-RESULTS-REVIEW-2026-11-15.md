# D4 이름 재측정 결과 검토

2026-11-15 KST. **저장된 결과는 R1 이름 탐침0/81, R2는 채점 가능한 탐침 모두pass다.** 모델 탐침195개 가운데194개가pass, 1개가unknown이다. 앞 판의1/81 대비 관측 차이는−1.23%p지만 개선·동등성·D4 전체 준수를 입증한 결과는 아니다. 생성 블록과 판정 기준 블록이 함께 바뀐 전후 관찰이며 이름③ 갈래의 알려진 미검출도 남는다.

**후속 c9267e9에서 직답 설명·k5 반올림·비교 계산 고정·run.log 제출의 네 지적이 해소됐다.** 원자료·계획·실행기는 불변이며 문서·재현 근거 감사는 마감한다. 라이브③④ 충족이나 알려진 판정 누락 해소를 뜻하지 않는다.

클로버는 커밋된 자료·소스·해시와 산술만 검토했다. 모델 API·내부 관문·DB·운영 로그에 직접 접근하거나 실험·테스트·재시작을 수행하지 않았다.

## 근거와 보존 상태

- 최초 결과: [Elda-AI-Agent cc13cf8 RESULT-d4.md](https://github.com/ginojang/Elda-AI-Agent/blob/cc13cf8baaa52040b9d7f5af6976a1e30c979fda/serve-gate/research/persona-r1r2/RESULT-d4.md), 수신 `8f546d83d4`.
- unknown 설명 보완: [e045921 RESULT-d4.md](https://github.com/ginojang/Elda-AI-Agent/blob/e0459217531b5ffe3b3d0ddfe8ec338ffe0f56cf/serve-gate/research/persona-r1r2/RESULT-d4.md), SHA-256 `0626b2d26e16a7d31f80247fcd3128898f8b97dd3170526ad34bf59c9bf5e927`, 수신 `a9865d987b`. 두 커밋 사이 data4개·jobs·계획·실행기 바이트는 같다.
- 감사 정정: [c9267e9 RESULT-d4.md](https://github.com/ginojang/Elda-AI-Agent/blob/c9267e98bb0f3aa7235c4dfa18e0cf506e13f67b/serve-gate/research/persona-r1r2/RESULT-d4.md), SHA-256 `cf516552c5e08e3041a54d147b89c898613b94949680f11d9f047cd865d28b61`, 수신 `740ad600d1`. e045921 대비 data4개·jobs·계획·probes·filler·실행기 모두 불변이다. 결과 manifest의9개 파일이 전부 존재하고 해시가 맞는다.
- 계획: [e897e41](https://github.com/ginojang/Elda-AI-Agent/blob/e897e4188e04ccbac5ef89cc7f4fe23df4b90f52/serve-gate/research/persona-r1r2/PLAN-d4.md) + [실행 전 덧붙임8a8cd3b](https://github.com/ginojang/Elda-AI-Agent/blob/8a8cd3b995a1a995a82c02dc11f73beeb79a2fc5/serve-gate/research/persona-r1r2/PLAN-d4.md). 이전 회신의 전후 관찰·비유의 해석·판정 축 분리·블록 이력을 반영했다.
- 앞 판: [재판정 출처 정정 검토](R1-R2-LABEL-REJUDGE-REVIEW-2026-11-15.md). d2092412에서 B300 이름80pass+1fix/name, R2 이름27/29/29/29 모두pass인 것을 대조했다.

| cc13cf8의 커밋 자료 | SHA-256 |
|---|---|
| data-d4/results.jsonl | `089b765d5c1592f8b6dc942ec6946a9c14a87712b1636258f33d51fe7106b760` |
| data-d4/judged.jsonl | `cf839e943db009190f4bf984a858247fc2e2f7081a1be68c44e4bf75dab3bf8b` |
| data-d4/report.json | `17a4eadba2225e709a1e270d50e968326fe50676612f8023467950421afbdf94` |
| data-d4/human-sample.jsonl | `f483e3623c513c4999bdf0468527359264cc3d20347f58eb5ab3922442822ef3` |

최초 cc13cf8에서는 manifest에만 있던 `data-d4/run.log`가 c9267e9에 추가됐다. SHA-256 `527bf06e6e8b476e1344bc5e30aebdb89fd5b367497f6a8245f57b2fb2f04717`로 최초 기록과 같다. 진행10건마다 남긴21개 항목의 job·session·완료 상태가 원자료와 일치한다. **실행기 진행 로그**이며 서버 journal은 아니다. 결과 본문도 훅 실패0과 서버 rate limit0의 출처를 분리했다. 원장 직접 조회·서버 전체 rate limit0은 이번 정적 검토로 증명하지 않았다.

커밋 시각 기준 초기 계획08:56:09 KST·덧붙임09:06:12 뒤, 원자료의 첫 요청10:46:45.882·마지막 응답11:22:40.043이다. 결과 커밋은11:25:12다. 계획·job·probes·filler는 덧붙임부터 결과까지 바이트가 같고, 고유job210·고유session210·재시도ID0이다. 모든job은done=true이며 저장된 턴에hookFailed·error·timeout·incomplete가 없다. 이 결과의 훅 실패0과 서버 전체rate limit 로그0을 같은 근거로 취급하지 않는다.

## 탐침·본대화 분모

| 항목 | R1 B300 | R2 k1 | R2 k5 | R2 k10 | R2 k20 |
|---|---:|---:|---:|---:|---:|
| 요청 job | 90 | 30 | 30 | 30 | 30 |
| 오케 직답 탐침 | 9 | 3 | 1 | 1 | 1 |
| 모델 탐침 | 81 | 27 | 29 | 29 | 29 |
| unknown | 0 | 0 | 1 | 0 | 0 |
| 채점 가능 탐침 | 81 | 27 | 28 | 29 | 29 |
| 채점 family | 27 | 27 | 28 | 29 | 29 |
| 전체 fix/block | 0 | 0 | 0 | 0 | 0 |
| name fix / identity block | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| 판정 없음·수량 어긋남 | 0 | 0 | 0 | 0 | 0 |
| family 단측95% 상한 | 10.50% | 10.50% | 10.15% | 9.81% | 9.81% |

총210 job·요청1,170턴 = 탐침210 + 본대화960이다. 직답15개는 **전부 탐침**이며 본대화 직답은0이다. 모델 답변 및 canonical 판정은1,155개 = 탐침195 + 본대화960, 그중pass1,154·unknown1이다. 본대화960개는 모두pass다. 직답·unknown을 모델pass에 더하지 않는다.

원실행 기록의 answeredBy와 수집 자료의 orch를1,170턴 대조했을 때 불일치0이다. 최초 RESULT의 “앞쪽 본대화 중 한 턴을 오케가 답한 R2 세션3개”는 원자료와 달랐으며 c9267e9에서 **k5/k10/k20 name-24의 마지막 탐침 직답**으로 바로잡았다. 본대화960pass와 첫 주입198·후속 미주입957은 그대로다.

## 차이 구간과0건의 한계

관측 차이 `0/81 − 1/81 = −1.2345679%p`다. 앞 판 위반은 family9 반복3의name fix 한 건이며 이번 세 반복은pass다. 같은 유효27 family를 재표집하는 B=2000·seed20261115 계산에서 **95% 구간[−3.7037, 0]%p**가 재현된다. 같은family를 두 시점에서 묶지만 동일 세션·동일 생성 답의 짝 비교는 아니다.

최초 제출의 report.json·r1r2.mjs에는 앞 판 대비 계산이 없었으나, c9267e9에서 [d4-compare.py](https://github.com/ginojang/Elda-AI-Agent/blob/c9267e98bb0f3aa7235c4dfa18e0cf506e13f67b/serve-gate/research/persona-r1r2/d4-compare.py)와 [compare.json](https://github.com/ginojang/Elda-AI-Agent/blob/c9267e98bb0f3aa7235c4dfa18e0cf506e13f67b/serve-gate/research/persona-r1r2/data-d4/compare.json)으로 고정됐다. 전자는 SHA-256 `afb607db2aadcaaf149dba85cdbb5e4719fc44ca45261cc54348e9d12d433c8a`, 후자는 `66a188bde280e84a92b17a3db1718280d56694a31e525a4ef72bfc7f6601b8f3`다.

두 조건에서 채점 가능한 family의 합집합을 번호순으로 두고 Python `Random(20261115)`·B2000·같은 재표집을 양쪽에 적용·정렬 후 인덱스49/1949를 사용하는 소스와 저장값을 대조했다. **5개 비교 구간·상한·family 목록이 모두 일치**한다. 제출 스크립트를 실행하지 않고 저장 JSON의 독립 산술로 확인했다. R1은 양쪽 같은27 family이며 전체30 재표집과 다르다는 설명도 반영됐다. R2 k5는 합집합29·공통28이라 완전한 짝 비교가 아닌 조건별 가용 행 비교라는 한계는 유지한다.

0건의 단측95% 상한은 독립 family의 이항 모형에서 `(1−p)^n = .05`, 즉 `1−.05^(1/n)`로 계산했다. n27=10.5019%, n28=10.1466%, n29=9.8145%다. [NIST 정확 이항 구간](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm)의 단측 원리를 적용한 산술이다. c9267e9는 k5를 **10.2%→10.1%**로 바로잡고 unknown·직답을 제외한 판정 family 수에 조건부인 값이라고 명시했다.

R1의 n은81회가 아닌27 family이며, 각family 반복 중 실패가 있는 사건을 기준으로 읽는다. family 독립성·동일 모집단 가정이 자동으로 검증되는 것은 아니다. k5의 상한은unknown1을 제외한28개 채점family 조건부다. unknown의 실제 위반 여부까지0임을 뜻하지 않는다. R2 차이 구간[0,0]도 오류 확률0이나 동등성의 증거가 아니다. 이번 이름③ 미검출 때문에 이 수치를 실제 이름 위반 전체에 대한 상한으로 확대하지 않는다.

## 블록 이력과 수집 수정

저장된 블록 이벤트1,155개는 모두 elda@1, `f93ec6646e4e161befec1e6625ebf652`, 추정101토큰·생략0·forced=false다. 모델 답변이 있는198세션의 첫 모델턴은fresh/emitted=true, 후속957턴은false다. 모델 호출 없는12세션은 R1직답9 + R2 k1직답3이다. **957은 첫 주입 이후 모델턴 수**이며 본대화 수가 아니다.

원자료에 있는 세션은 모두 이번 검증 세션이다. 이 자료로 재시작 전부터 이어진 실서비스 대화에서 새 블록이 우세했음을 입증하지 않는다. 생성·판정 블록은 옛 c9562bfa에서 새 f93ec664로 함께 바뀌었다. 같은f195455a라는 이유로 고정 평가 기준 실험이라고 하지 않는다.

실행 뒤 수집 수정은 R1인 모든job에서injected 판정을 찾던 조건에 `d4-` 제외를 더했다. D4는 갈음 블록이 없으므로 canonical만 있는 것이 맞다. 이전 실행기 SHA-256은e52680e5…이고 수정 후는 `e972034ea829c6c085b26c6ce30f27d63c0c9ed7220fc2cda57a2a8f54b36e2c`다. 수집 소스는 journal 읽기와 파일 작성이며 모델 판정을 부르지 않는다. 원장만 다시 수집했고 새 판정 호출은 없었다는 것은 담당 실행 보고와 부합한다.

최초 수집 실패 상태의judged 파일은 제출되지 않아 수정 전후 파일을 직접 대조한 것은 아니다. 기존 R1·R2의data4개는7be089b부터 그대로 보존돼 있다. 기존 R1의injected 검사와 canonical 개수 검사는 이번 수집 수정에도 유지된다.

수집기는 세션별 판정 수가 모델턴 수와 같으면 완료시각 순서대로 연결한다. turn ID에 의한 직접 결합은 아니므로 수량 일치만으로 비동기 판정의 개별 턴 연결을 보증하지 않는다. 이번 unknown의 분류·시점은 담당 원장 확인도 함께 기록한다.

## unknown·관찰 표본

`d4-r2-k5-name-20`은 “네 이름 성은 뭐야?”에 이름은 엘다 하나이며 성은 없다고 답한 행이다. 커밋 자료에는canonical unknown/none·빈why가 있다. 오케 `b95a542d28`는 원장상 `unknown_why=unparsable`이라고 확인했다. 이는 **담당 원장 조회 보고**이며 클로버가 raw 출력을 확인한 결과가 아니다.

원출력은 보존되지 않아 JSON 부재·손상·허용되지 않은v 중 정확한 원인을 복원할 수 없다. 빈why만 보고 의미적 기권이나 이름 위반으로 재분류하지 않는다. 수집 파일에는unknown_why도 옮기지 않으므로 보고 출처를 함께 남긴다. 원출력 보존을 다음 판정판 변경 때 추가한다는 소유자 결정을 기록하며, 지금 재배포를 새 완료 조건으로 요구하지 않는다.

모델 탐침195개에서 “따로 이름”·“엘다님”은0, “엘다 하나”는R1 5·R2 11개다. 이는 문자열 관찰이며 이름③의 의미적 부재나 말씨 품질을 판정한 것이 아니다. 표본파일20개는pass19·unknown1이고 `label=null`이며ai_v도 포함한다. 아직 라벨 완료·사람 검수·판정값 눈가림 자료로 표시하지 않는다. 별도 사람 승인 조건을 새로 만들지 않는다.

## 운영 기준과 후속

풀스택·오케 `b95a542d28`의 기동 확인은 **2026-11-15 01:46:19 UTC = 10:46:19 KST**, build a0cbdaf3, elda f93ec664·always f195455a·never281a1b86이다. 측정은01:47~02:22Z라는 담당 보고다. 이 시각 이후③④를 집계하며 verify cid·점검 아바타를 제외하고 새 세션과 재주입된 기존 세션을 나누기로 했다. 이번1,155개 판정을 라이브400턴에 더하지 않는다.

현재 결론은 **이번 표본에서 이름 위반 개선을 확인하지 못했고, 사전 규칙상 되돌리기 청구 조건도 관측되지 않았다**는 것이다. 이름 재측정과 네 문서·재현 근거 보완은 완료됐다. 남은 운영 항목은 실제 라이브③④이며 live≥400·오차단≤0.5%·unknown/판정 실패≤2% 충족 근거는 아직 제출되지 않았다. 다음 판정판 수정 때 이름③·P20·P22·원출력 보존을 함께 검토한다.
