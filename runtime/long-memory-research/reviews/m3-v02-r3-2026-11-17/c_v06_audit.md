# C 평가 묶음 v0.6 — 반복 약속 원천 선택 감사

2026-11-17 · 클로버. **기존13개는 바이트 그대로 보존됐고, 새 d01/d02의 `_gold`는 약속 근거로 pass 턴5를 올바르게 선택한다.** 다만 `_gold`의 첫 assistant fallback과 키워드 매칭은 관련 있는 약속 근거를 일반적으로 보장하지 않는다.

- 비교 ref: `elda-resoner@b91323f4580e17fec9431289c88e0f601dccd669` → `80b386fb449bac1e05d78451c3033c4716617803`.
- 대상: `memory/data/s6_memory_chat_eval_v0_6/{META.json,eval.jsonl}`, `memory/scripts/s6_memory_chat_eval.py`.
- [재현 코드](c_v06_audit.py), [원자료 비교·합성 진단](c_v06_audit.json).

Git 소스를 읽고 hash 고정 `_gold`와 `score_rows`만 AST 추출했다. 상위 모듈/main/build/teeth·운영 함수·모델·API·DB는 실행하지 않았다. **새 K=3 실행은 수행하지 않았다.** 기존 감사·봉인 자료도 수정하지 않았다.

## 기존 자료와 새 두 사례

v0.6은15행·기대 약속5개다. 기존 v0.5의13행·기대 약속3개는 새 JSONL의 정확한 바이트 prefix이며, 구 v0.5 파일도 새 ref에 그대로 남아 있다. 기존13개에 대해 `_gold`가 만드는 예측 역시 동일하다. `score_rows` 함수 AST도 이전 판과 같다. 이번 변경은 데이터 추가와 합성 gold 예측의 원천 선택 변경이다.

| 추가 사례 | 언어 | 동일한 약속 원문 | S6 | 기대 키워드 | 새 `_gold` 약속 근거 |
|---|---|---|---|---|---|
| d01 | 한국어 | assistant 턴1과5가 동일 | 1=block, 3=none, 5=pass | 순서표 | turn5/pass |
| d02 | 영어 | assistant 턴1과5가 동일 | 1=block, 3=none, 5=pass | repair kit | turn5/pass |

두 사례에는 약속 키워드를 포함하는 유일한 pass assistant 턴이5다. 실제 골드의 `expect.promises`는 키워드 `contains`만 저장하며, 기대 원천 번호5를 별도 필드로 고정한 것은 아니다. 현재 사례 구성과 S6 검사를 결합하면 올바른 약속 원천은5가 된다.

**episode did의 근거는 별개로 두 사례 모두 turn3/none**이다. `_gold`는 episode에 첫 fix/block이 아닌 assistant 턴을 고르는 기존 방식도 유지한다. 따라서 ‘모든 gold 원천이 pass5’라고 표현하면 부정확하다. 이는 did에 none을 허용하는 현 계약과 봉인 M3의 pass-only 기준을 구분해야 하는 지점이다.

구 `_gold`를 새15행에 적용하면 처음의 block 턴을 약속 근거로 골라13/15가 되고, 새 `_gold`는15/15가 된다. 이 숫자는 **합성 예측 생성기·채점기의 자기검사**이며 모델 성능 향상이 아니다. 실제 d01/d02의 근거 번호를 동일 원문인 block 턴1로 바꾸는 두 진단은 모두 `promise_not_pass=1`로 실패했다.

## 원천 선택의 남은 한계

`s6_memory_chat_eval.py:174–176`의 `_src`는 기대 키워드를 포함하는 첫 pass assistant 턴을 찾고, 없으면 첫 assistant인 `a`로 돌아간다. :110–127의 채점은 기대 키워드가 예측 약속 텍스트 또는 근거 글에 포함되는지와 원천 pass/원문 일치를 따로 확인한다. 약속 텍스트가 근거에서 실제로 도출되는지는 검사하지 않는다.

최소 추가 진단에서 다음을 확인했다.

1. 원래 turn5를 unknown으로 바꾸어 매칭 pass가 없어지면 turn1/block으로 fallback하고 실패한다.
2. 같은 조건에서 첫 assistant를 **약속 키워드가 없는 관련 없는 pass**로 바꾸면, `_gold`는 그 턴을 근거로 삼고도 통과한다. 기대 키워드는 `_gold`가 예측 `t`에 넣기 때문에 기대 약속 적중 검사가 성립한다.
3. turn3을 키워드를 포함하지만 약속을 부정하는 pass 문장으로 바꾸면, 뒤의 실제 약속 turn5보다 turn3을 먼저 선택하고도 통과한다.

총5개 진단은 위3개와 실제 두 사례의 block 원천 대체2개다. 추가 기대값은 클로버 작성이며 공식 gold·사람 라벨·모델 측정이 아니다. 특히2번은 적격 근거가 없는 기대 약속을 일부러 유지하여 **향후 잘못된 gold가 자기검사에서 드러나지 않을 가능성**을 확인한 것이다. 현재15개 원자료가 잘못됐다는 주장과 구분한다.

좁은 보완 방향은 매칭 pass 근거가 없으면 unrelated fallback 대신 gold 생성 오류로 드러내는 것이다. 다만 이 보완만으로 키워드를 포함한 인용·부정·다른 약속과의 의미 관계까지 검증할 수는 없다.

## 커버리지와 해석

새 두 사례는 모두 ‘먼저 block, 나중 pass, 약속 문장은 완전 동일’이라는 같은 구조의 언어 변형이다. pass가 먼저인 역순, 여러 pass 중 다른 약속 선택, 표현이 달라진 같은 약속, 적격 pass 부재, 키워드만 등장하는 부정·인용을 실제15개 세트가 모두 포함하는 것은 아니다. 별도의 통계적 독립 사례2개 또는 광범위 원천 선택 성능으로 확대하지 않는다.

커밋 설명은 r3의 n08 약속 누락을 보완하는 개발용 사례라고 명시한다. 공개된 사례를 통한 후속 점수는 해당 회귀 문제의 pretest 증거이며 미열람 holdout 일반화 증거가 아니다. 이미 있는13개와 새2개 결과도 필요하면 나누어 읽어야 한다. 이 감사는 오케 담당의 후속 K3 결과를 대신하지 않는다.

META의 작성자는 claude이며 `prompt_pair`의 v0.002 문자열은 이전 판에서 유지됐다. 이 메타 문자열만으로 후속 실행의 실제 C 프롬프트 판을 확인할 수는 없다.

## 식별·재현

- v0.6 gold MD5: `649911e73dafef3ed09a15e134e28ef3`.
- v0.6 gold SHA256: `216f6a39d7337a2304ee4038677e71ebdc7cfc48687f06d84be41583155c7064`.
- 새 scorer 파일 SHA256: `717c9f2d33e222f19e152fc56a58a7898c822333a3fc589e90683aefd0b6a094`.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/c_v06_audit.py --output runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/c_v06_audit.recheck.json
```

출력은 새 파일에만 쓴다. 저장소 안 임시 경로에서 재실행해 기존 감사 JSON과 바이트 일치를 확인했고, 기존 r3 감사5개 파일의 SHA256도 실행 전후 동일했다.
