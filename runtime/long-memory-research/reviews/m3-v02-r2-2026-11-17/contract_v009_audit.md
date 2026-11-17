# 계약 v0.009 — 원천 정수 검사·조회 실패·고정 K3 대조

2026-11-17 · 클로버. 이전 C boolean/float 원천 반례는 새 채점기에서 차단됐다. 고정된 f313 K3의 점수는 그대로 재현됐다. 다만 계약의 S6 허용 목록은 채점기와 확인한 런타임 모두 아직 강제하지 않는다.

- 구 리소너: `5bbf43b2d22cdf386715979668dd21b82234ba6a`.
- 새 리소너: `0334e5e228fc51d2cc988f8251746947242caf7d`.
- 런타임 정적 확인: `GanpanAI@b79015192a9055bca4902e8388e66707947c7c8b`.
- 고정 예측: `GanpanAI@f31375dd8a1f8cdbaa61d167d47ee66606f007f5`.
- [재현 코드](contract_v009_audit.py), [재계산·16개 진단](contract_v009_audit.json).

검토한 Python 함수만 AST로 추출했다: `score_rows`, `_gold`, `teeth`, T의 `_match/_vmatch`. 상위 모듈/main/build, TS 운영 함수, 모델·API·DB는 실행하지 않았다. 추가 진단은 클로버가 만든 합성 반례이며 새 모델 측정이나 공식 골드가 아니다. 기존 감사 산출은 수정하지 않았다.

## 마감 가능한 정수 원천 보완

| 구분 | 새 소스 위치 | 추가 진단 결과 |
|---|---|---|
| C did | `memory/scripts/s6_memory_chat_eval.py:123–127` | 이전 true/1.0 반례 모두 rows_ok 1→0, did_no_source=1 |
| C promise evidence | 같은 파일 :109–113 | true/1.0 모두 promise_not_pass=1 |
| T 일반 evidence | `memory/scripts/s6_memory_turn_eval.py:212–216` | true/1.0 모두 evidence_not_human=1 |
| T correction_evidence | 같은 파일 :174–177 | true/1.0 모두 SUPERSEDE→CONTEST로 내림, 기대 SUPERSEDE와 불일치 |

모든 추가 타입 반례는 구 채점기에서는 통과하고 새 채점기에서는 실패한다. 이는 채점기의 잘못된 정수 동등 비교를 막았다는 확인이다. 새 기준이 운영 JS와 완전히 같은 파싱을 한다는 뜻은 아니다. JS는 파싱된 숫자1.0과1을 구분하지 않지만 Python의 `type(x) is int`는 1.0을 거부한다.

새 upstream teeth는 T 8조건·C 9조건 GREEN으로 재현됐다. C의 추가 teeth 분기는 현재 fix/block 두 사례의 assistant index가 모두1이어서 boolean 경로만 실제 사용한다. T의 새 teeth는 float 일반 evidence를 검사한다. 빠져 있던 float C 원천, boolean T evidence, typed correction_evidence는 이번 추가 진단에서 각각 확인했다.

## 조회 실패는 제외되지만 상태·이유를 따로 읽어야 한다

새 C scorer :129–134는 `lookup_error` 원천 did를 kept에서 제외하고 `counts.did_held_lookup_error`를 증가시킨다. 이 사건은 gate가 아니며 `rows_ok=False`를 직접 설정하지 않는다.

- 유일한 필수 design이 보류되면 episode_acc=0·rows_ok=0·held=1·gate0이다.
- 다른 정상 pass 원천의 design이 있고 추가 quote만 조회 실패로 보류되면 episode_acc=1·rows_ok=1·held=1·gate0이다.

따라서 행 통과·관문0이 조회 실패0을 뜻하지 않는다. 재시도 완료나 실제 저장 여부도 이 순수 점수에서 확인하지 않는다.

계약 v0.009은 did 허용 값을 pass/unknown/none으로 명시하지만, scorer는 fix/block/lookup_error만 별도로 처리하고 나머지를 :134에서 받는다. b790의 `s6chatEnd.ts:104–105`도 같은 배제 방식이다. 합성 `unexpected_verdict`와 `abstain`은 새 scorer에서 행 통과·gate0이었다. **명시한 허용 목록과 구현이 아직 다르다.** 정상 unknown·none·판정 키 부재는 이번 진단에서 계속 허용됐다.

b790의 gather :43–47은 판정 조회 실패를 `lookup_error`로 보존하며 didSourceWhy :104는 이를 거부한다. 이는 이전 unknown 변환 경로를 소스에서 구분한 보완이다. 실제 DB 조회 실패를 일으키거나 재시도를 측정하지 않았다.

| 위치 | 조회 실패 이름 | 의미/단위 |
|---|---|---|
| 계약 v0.009 | `did_s6_lookup_error` | 보류 사유 명칭 |
| b790 런타임 | `did_source_lookup_error` | didSourceWhy 반환 사유 |
| 새 C scorer | `counts.did_held_lookup_error` | 제외·보류한 did 항목 수; gate 아님 |

이 세 이름을 같은 원장 키로 가정해서는 안 된다. 대응 관계를 명시하거나 통일해야 집계 누락을 피할 수 있다.

## 골드 불변과 기존 K3 재계산

T/C v0.5의 gold와 META가 5bb→0334에서 바이트 동일하다. T는39행·MD5 `3372c065ac4008ea281e9bd603d94969`, C는13행·MD5 `c9ef1b200f37ee718c7232ef22ea8477`이다. 이번 판에서 평가 문장이나 기대값을 바꾼 것은 없다.

| 고정 f313 예측 | 처리 후 점수·관문 | parsed raw를 같은 채점기에 넣은 점수·관문 |
|---|---|---|
| T 117행 | 38·37·38 /39, gate 각0 | 38·37·38 /39, value_wrong 각1 |
| C 39행 | 13·13·13 /13, gate 각0 | 12·11·12 /13, did_source_bad 1·2·1 |

저장된 두 score JSON, 이전 감사의 처리 후/원출력 요약, 회차별 전체 결과가 새 scorer와 모두 일치한다. 원출력의 scorer 내부 처리도 그대로 적용되므로 이를 완전히 별개의 의미 판정으로 읽지 않는다. 새 모델 실행·운영 배포의 통과 증거가 아니며 lookup_error 경계는 위 별도 합성 입력으로 확인했다.

## 재현과 식별

기존 파일을 지우지 않고 저장소 안의 새 출력 경로를 지정한다. 이미 존재하는 출력 파일은 덮어쓰지 않는다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/contract_v009_audit.py --output runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/contract_v009_audit.recheck.json
```

저장소 안 TemporaryDirectory에서 `--output`으로 다시 실행해 감사 JSON의 바이트 일치를 확인했다. 이전 K3·v0.008·raw 감사의 8개 파일 SHA256도 실행 전후 동일했다.

- 새 T scorer SHA256: `351aed4057417e039dba2bef4df67ad53338b381aa6cb0782b26f47d05c38eff`.
- 새 C scorer SHA256: `41f37f94898fee4a77765f9bbdbaf717bf3962f0b726b30e60f2eedffa0bb9ce`.
- 고정 예측·골드·기존 감사 산출의 SHA256과 비교 결과는 JSON에 기록했다.
