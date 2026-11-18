# C v0.6 후속 — `_gold` fallback 제거 확인

2026-11-17 · 클로버. **적격 pass 근거가 없을 때 첫 assistant로 돌아가던 fallback과 여러 매칭 중 첫 원천을 임의 선택하던 동작은 제거됐다.** 유일한 키워드 포함 pass 원천이 실제 약속인지를 보증하는 의미 검사는 여전히 없다.

- 비교: `elda-resoner@80b386fb449bac1e05d78451c3033c4716617803` → `542bd9a9b29c9f10ea1fe5fb24b20a195210f567`.
- 대상: `memory/scripts/s6_memory_chat_eval.py`, C v0.6 gold/META.
- [이전 감사](c_v06_audit.md), [후속 코드](c_v06_followup.py), [후속 결과](c_v06_followup.json).

hash 고정 소스의 `_gold`와 `score_rows`만 AST 추출해 실행했다. 상위 모듈/main/build/teeth·K3·모델·API·DB·운영 함수·로그는 실행하거나 열람하지 않았다. 기존 파일과 봉인은 수정하지 않았다.

## 현재 15개와 이전 다섯 진단

gold/META는 이전 ref와 바이트 동일하다. 실제15개에 생성되는 합성 gold 예측도 그대로이며, `score_rows` AST도 바뀌지 않았다. 자기점수15/15가 유지된다. d01/d02의 약속 근거는 여전히 turn5/pass이고 episode did는 turn3/none이다. 이 결과는 gold 생성기의 회귀 확인이며 모델 성능 점수가 아니다.

`_src`는 이제 키워드를 포함하는 pass assistant 턴 목록을 만든 뒤 개수가 정확히1이 아니면 `ValueError`를 낸다(`s6_memory_chat_eval.py:174–178`).

| 이전 진단 | 수정 후 결과 |
|---|---|
| d01의 동일 약속을 block 턴1에 연결 | 계속 `promise_not_pass` 채점 실패 |
| d02의 동일 약속을 block 턴1에 연결 | 계속 `promise_not_pass` 채점 실패 |
| 매칭 pass 없음·첫 assistant는 block | 매칭0개 `ValueError`; gold 생성 중단 |
| 매칭 pass 없음·첫 assistant는 관련 없는 pass | 매칭0개 `ValueError`; 잘못된 fallback 제거 |
| 앞 부정 문구 pass와 뒤 실제 약속 pass가 모두 키워드 포함 | 매칭2개 `ValueError`; 첫 원천 임의 선택 제거 |

뒤의 세 결과는 **자료 구성 오류**이며 모델이 새로 실패한 실행으로 세지 않는다. 정확히1개라는 조건은 이 합성 gold 생성기의 조건이다. 실제 운영에서 같은 약속을 정상 pass 턴 여러 번에 반복하는 행위를 금지한 정책으로 확대하지 않는다.

## 의미보증으로 마감할 수 없는 범위

추가 진단에서는 앞선 부정 문구의 pass 턴3만 유일한 키워드 매칭으로 남기고 뒤의 실제 약속 턴5를 unknown으로 바꿨다. `_gold`는 turn3을 선택하며 `score_rows`는 여전히 행 통과·관문0을 반환했다.

새 조건은 **원천의 유일성**을 확인한다. 그 문장이 인용·부정·다른 약속인지, 예측 약속이 그 근거에서 실제로 도출되는지는 검사하지 않는다. 채점기는 예측 약속 텍스트의 키워드와 원천 pass/원문 일치를 별도로 확인하는 기존 방식 그대로다. 이 추가 진단의 기대 해석은 클로버 작성이며 공식 gold나 사람 라벨이 아니다.

현재15개 원자료에 새 오류가 있다는 증거로 해석하지 않는다. 해당15개에 대한 좁은 fallback 보완은 확인됐고, 의미 검증의 한계는 별도로 남는다. 공개된 개발용 사례의 자기검사를 미열람 holdout 일반화나 운영 K3 결과로 부르지 않는다.

## 보존·재현

- v0.6 gold MD5: `649911e73dafef3ed09a15e134e28ef3`.
- gold SHA256: `216f6a39d7337a2304ee4038677e71ebdc7cfc48687f06d84be41583155c7064`.
- 새 scorer 파일 SHA256: `583dc189ca772c3484d1d5ce0d9636d16301b73ab66ea0bcd8570cbdd43e1df4`.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/c_v06_followup.py --output runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/c_v06_followup.recheck.json
```

기존 출력은 덮어쓰지 않는다. 저장소 안 임시 경로에서 재실행해 후속 JSON의 바이트 일치를 확인했다. 이전 C v0.6 및 r3 감사8개 파일의 SHA256도 실행 전후 동일했다.
