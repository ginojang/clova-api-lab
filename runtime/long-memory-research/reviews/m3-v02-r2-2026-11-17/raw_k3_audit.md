# 계약 v0.008·C v0.006의 원출력/처리 후 K=3 감사

2026-11-17 · 클로버. 저장된 합성 자료를 읽고 검토한 순수 Python 채점 함수만 실행했다. 모델·API·DB·운영 함수·상위 CLI/build는 실행하지 않았다. 기존 K3 산출은 변경하지 않았다.

- 결과·생산자 소스: `GanpanAI@f31375dd8a1f8cdbaa61d167d47ee66606f007f5`.
- 계약·골드·채점기: `elda-resoner@5bbf43b2d22cdf386715979668dd21b82234ba6a`.
- [재현 코드](raw_k3_audit.py), [재계산·원출력 대조](raw_k3_audit.json), [계약 변경·14개 합성 진단](contract_v008_audit.json).
- 결과 경로: `elda-orchestrator/measurements/eldacore/s6_memory_20261117/`.

재현할 때 `--output`에 저장소 안의 새 파일 경로를 지정한다. 기본 산출물과 이미 존재하는 출력 파일은 덮어쓰지 않는다. 예:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/contract_v008_audit.py --output runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/contract_v008_audit.recheck.json
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/raw_k3_audit.py --output runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/raw_k3_audit.recheck.json
```

두 명령을 저장소 안 임시 디렉터리의 새 경로로 실행해 각각 기존 감사 JSON과 바이트 단위 일치를 확인했다.

## 저장 점수와 원출력 점수

두 저장 score JSON을 새 판의 순수 채점기로 정확히 재현했다. T는 39사례×3=117행, C는 13사례×3=39행이다. 각 ID에 rep=0·1·2가 있으며 빠진/추가 ID가 없다. 전 행 measured=true이고 원출력 JSON을 파싱할 수 있었다.

| 자료 | 저장된 처리 후 점수 | 같은 채점기에 원출력 필드를 넣은 점수 | 관문 |
|---|---|---|---|
| T v0.010 × 골드 v0.5 | 38·37·38 /39, 과반38/39 | 38·37·38 /39 | 처리 후 각0; 원출력은 value_wrong 각1 |
| C v0.006 × 골드 v0.5 | 13·13·13 /13, 과반13/13 | 12·11·12 /13 | 처리 후 각0; 원출력은 did_source_bad 1·2·1 |

원출력 점수도 채점기 내부의 정정 근거 내림/T 및 did 제외/C를 거친 결과다. 별도의 의미 판정이나 실서빙 결과가 아니다. K=3 과반은 사례별 행 통과 불리언의 과반이며 모델 답안을 투표로 고른 결과가 아니다.

`src/tools/s6ChatEndBatch.ts:29–33`은 did kind/원천 검사를 적용한 `episode`를 반환하면서 원문 `raw`를 함께 저장한다. `src/tools/s6Batch.ts:13–15`도 처리 후 `ops`와 `raw`를 함께 저장한다. 따라서 파일명 `_raw`는 원출력 보존을 뜻하며 기본 채점 필드가 원출력이라는 뜻은 아니다.

## C: 원출력 네 건을 제외한 뒤의 39/39

원출력 did는 반복별 10·11·10개, 처리 후는 9·9·9개다. 다음 네 did가 빠졌으며, 각 원천은 실제 골드의 assistant 턴이다.

| 사례 | rep(0기반) | 원천 S6 | 원출력 did kind | 처리 후 |
|---|---:|---|---|---|
| x02 | 0 | block | quote | did 제외 |
| p02 | 1 | fix | quote | did 제외 |
| x02 | 1 | block | quote | did 제외 |
| p02 | 2 | fix | quote | did 제외 |

p02·x02의 6회 중 4회에 금지 원천을 인용한 did 제안이 있었다. 실제 DB 쓰기나 저장 성공을 뜻하지 않는다. 이번 자료에서는 raw_promises와 처리 후 promises가 전 행 같고 반복별 3개씩이다. 약속 필터가 이 네 오류를 없앤 것이 아니라 did 원천 필터가 제외했다.

새 C scorer `memory/scripts/s6_memory_chat_eval.py:121–138`은 잘못된 did를 빼면서 `rows_ok=False`를 유지한다. 그러므로 원출력에 대해서도 처리 후 kind가 기대에 맞으면 `episode_acc=1`이면서 행 실패·원천 관문 위반이 동시에 나타난다. 정상 did와 나쁜 did가 함께 있어도 행 실패이며, 같은 행의 나쁜 did 두 개는 `did_source_bad=2`로 센다. 관문 건수와 실패 행 수는 다른 단위다.

## T: 내림 없이 보존된 정정과 남은 실패

- k09 원출력부터 CONTEST 3/3이며 처리 후도 같다.
- s01·s02 원출력부터 SUPERSEDE 각각3/3이며 `correction_evidence`를 포함한다. 처리 후 연산 종류도 같다.
- 처리 후 `downgraded` 표지와 채점기 내림은 모두0이다. 이번 K3에서 내림 분기를 실행한 성공 증거는 아니다.
- j01은 매 반복 `美容室`을 `미용실`로 제안해 `value_not_in_evidence`로 빠졌다. 원출력 채점에서는 `value_wrong` 각1, 처리 후에는 필수 business ADD 누락으로 실패한다. 같은 행 실패가 원출력의 값 오류와 처리 후의 회수 손실로 각각 보인다.
- 추가 실패는 k16 rep1의 NOOP다. 고정 골드는 ADD/health/당뇨를 기대한다. 모델은 동의 없는 민감정보라는 이유를 냈다. 여기서는 고정 채점 기준상의 기대 연산 누락으로만 보고하며, 그 이유 자체가 정책적으로 잘못됐다고 별도 판정하지 않는다.

## 계약·골드 변경의 범위

구 C v0.4는 새 리소너 ref에서도 바이트 보존됐다. 새 C v0.5는 p02·x02의 `expect.episode_kinds`만 `["quote"]`에서 null로 바뀌었다. 입력 문장·13개 ID·순서·나머지 기대값은 같다. 새 MD5는 `c9ef1b200f37ee718c7232ef22ea8477`이다.

계약 v0.008과 C v0.006은 약속의 pass 필수를 유지하고, did는 assistant 원천을 필수로 하되 fix/block을 제외하며 unknown/판정 없음은 허용한다. 이는 이전 M9와 다른 정책이다. 구 v0.4 점수와 새 v0.5 점수를 직접 비교해 모델 개선으로 부르지 않는다. Git으로 정책·기대값의 일관된 변경을 확인했지만, 저자가 예측 결과를 보기 전에 결정했다는 작업 과정까지 독립 입증하지는 못했다.

`5bbf43b2` 자체에는 새 모델 예측/score 파일이 없다. 그 판의 `_gold` 13/13과 `teeth`의 8개 조건 GREEN은 순수 채점기 자기점검이다. 실제 새 K3 자료는 별도 `f31375dd8`에 들어 있다.

## 채점기 경계 진단

[14개 합성 진단 코드](contract_v008_audit.py)는 hash 고정 소스에서 `score_rows`, `_gold`, `teeth`만 AST 추출한다. 추가 진단의 기대값은 클로버 작성이며 공식 골드·사람 검수·모델 측정이 아니다.

- 기존 teeth는 fix/block did·원천 번호 부재를 검사하고, p03 gold self-score를 통해 unknown 허용을 간접 확인한다. 판정 없음, user 원천, 존재하지 않는 턴, 정상/나쁜 did 혼재는 추가 진단으로 확인했다.
- **Python scorer의 원천 타입 오류가 있다.** :122–126에서 `True`/`1.0`은 정수1인 assistant 턴과 같게 비교되지만 S6 조회 키는 `"True"`/`"1.0"`가 되어 `"1":"fix"`를 놓친다. 별도 정상 pass 턴이 있는 합성 입력에서 잘못된 fix 원천을 이 값으로 인용해도 행 통과·관문0이었다. strict int 또는 계약에 맞는 정규화 검증이 필요하다.
- 이 반례는 운영 TS guard와 구분한다. `s6chatEnd.ts:98–103`은 boolean을 타입 검사로 거절하고 JavaScript의 숫자1.0은 문자열 키 `"1"`로 조회한다. 이번 C 원출력 did의 turn_index 31개는 모두 Python int이며, 이 결함이 이번 저장 점수를 바꿨다는 근거는 없다.
- :135는 기대 kind의 포함 여부를 본다. 정상 design에 기대하지 않은 quote를 더해도, `what`을 지어낸 내용으로 바꿔도 통과한다. `promise_false`는 약속 목록의 지표이며 모든 거짓 episode/약속 내용의 우회 저장까지 측정하는 지표가 아니다.

## 원자료 식별

| 파일 | SHA256 |
|---|---|
| `s6_memory_chat_v05_pred_k3_6d7325df_prompt-v0006_raw.jsonl` | `f4fec03db617bfdd6207208dba2abed32fa8d1a8d7d0a0ca936f7f924704bd5a` |
| `s6_memory_turn_v05_pred_k3_2a41e14b_prompt-v0010_raw.jsonl` | `35187f8d59d869f6d88d7eedf8ac7db93f877eb9fda7af26488c709a7b0d43c2` |
| C v0.5 gold | `356d04559d3a35be371a0f9f63af357bd2751cfe7bea51510124c24c18213c8c` |
| 新 C scorer | `03cfd5927c76774eaa6a850715073a8baf4927b8e52645282c3f8b449fd98246` |
| 新 T scorer | `8fb06e8ae9ead6a9b1213d89ff1225b28c8e27cd171f0e2880fa1843509a6ff2` |

저장 score·이전 감사 산출 SHA256은 JSON에 함께 기록했다. 이 소규모 합성 재실행은 새 홀드아웃이나 M3 84탐침 통과, 배포·DB 적용 확인을 대신하지 않는다.
