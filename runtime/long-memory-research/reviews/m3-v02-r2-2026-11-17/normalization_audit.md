# S6 정규화 후속 — C 채점기 허용 목록과 사유 키

2026-11-17 · 클로버. **목록 밖 S6 값을 받던 C 채점기 문제는 이번 확인 범위에서 해소됐다.** 운영과 채점기는 목록 밖 값을 모두 제외하지만 그 사유 이름은 아직 다르다.

- 비교: `elda-resoner@0334e5e228fc51d2cc988f8251746947242caf7d` → `b91323f4580e17fec9431289c88e0f601dccd669`.
- 운영 소스는 `GanpanAI@1ba433abdc3e43fd9486d099cd854e16768912fa`의 didSourceWhy만 읽었다.
- [재현 코드](normalization_audit.py), [결과·합성 9조건](normalization_audit.json). hash 고정 C `score_rows/_gold/teeth`만 AST 추출해 실행했다. 상위 모듈/main/build·운영 함수·모델·API·DB는 실행하지 않았다.

## 정규화 9조건

같은 유효 assistant 원천의 필수 design did를 두고 S6 값만 바꿨다. 다음은 고정 기대값에 대한 순수 채점 결과이며 새 모델 측정이 아니다.

| S6 입력 | did 처리 | rows_ok | gate/보류 계수 |
|---|---|---:|---|
| pass | 받음 | 1 | 없음 |
| unknown | 받음 | 1 | 없음 |
| none | 받음 | 1 | 없음 |
| 해당 키 부재 | none으로 처리 | 1 | 없음 |
| fix | 제외 | 0 | did_source_bad=1 |
| block | 제외 | 0 | did_source_bad=1 |
| lookup_error | 보류·제외 | 0 | counts.did_s6_lookup_error=1; gate0 |
| abstain | lookup_error와 같이 보류 | 0 | counts.did_s6_lookup_error=1; gate0 |
| unexpected_verdict | lookup_error와 같이 보류 | 0 | counts.did_s6_lookup_error=1; gate0 |

`memory/scripts/s6_memory_chat_eval.py:129–135`는 키 부재를 none으로 두고, fix/block 이후 pass/unknown/none만 받는다. 나머지는 보류 계수로 센다. 이전 채점기에서 통과하던 abstain/임의 문자열 두 조건은 이제 제외된다. 여기서 부재는 **키가 없는 경우**이며, 명시적 JSON null이나 다른 잘못된 타입에 대한 광범위 검증은 수행하지 않았다.

이 표의 보류 행은 유일한 필수 kind가 빠져 rows_ok=0이 된 것이다. 보류 자체를 gate 또는 무조건 행 실패로 바꾸지는 않았다. 다른 정상 did가 기대를 충족하면 보류가 있어도 행 통과가 가능한 기존 집계 의미는 유지된다. upstream C teeth의 9조건도 GREEN으로 재현했다.

## 사유 키의 마감 범위

계약과 C scorer는 이제 `did_s6_lookup_error`를 사용한다. 운영 `s6chatEnd.ts:103–107`도 실제 lookup_error에는 같은 이름을 쓰지만, 목록 밖 값에는 `did_s6_unexpected`를 반환한다.

| 사건 | 계약/C scorer | 운영 1ba433ab |
|---|---|---|
| 실제 lookup_error | did_s6_lookup_error | did_s6_lookup_error |
| 목록 밖 값 | did_s6_lookup_error로 정규화 | did_s6_unexpected |

따라서 **실제 조회 실패의 이름 통일은 확인됐지만, 계약의 ‘모두 하나’는 목록 밖 값까지 포함하면 아직 성립하지 않는다.** 양쪽 모두 저장 대상에서 제외하므로 허용 오류와는 구분한다. scorer는 실제 조회 실패와 목록 밖 값을 같은 보류 계수로 합치고, 운영은 사유를 분리한다. 통합 보고 시 이 대응 관계를 적용해야 한다.

b913 계약은 unknown에 늦은 판정 호출 실패도 포함한다고 명시했고, did 허용 정책은 유지했다. 보류는 이번 C 저장에서 제외하고 사유를 기록하는 것이며 자동 재예약이나 복구 보장이 없다는 문구도 추가됐다. 이 감사는 해당 정책의 정의를 확인한 것이며 호출 실패나 복구를 새로 측정하지 않았다.

## 고정 K3와 산출 보존

T/C gold와 META는 0334→b913에서 바이트 동일하다. T MD5는 `3372c065ac4008ea281e9bd603d94969`, C MD5는 `c9ef1b200f37ee718c7232ef22ea8477`이다.

f313의 같은 C 39예측행을 새 scorer에 대조했다. 처리 후 13·13·13/13·gate0, 원출력 12·11·12/13·did_source_bad 1·2·1이며 저장 score JSON 및 이전 감사의 요약/회차별 전체 결과와 모두 같다. 고정 자료에 새 lookup_error·목록 밖 값이 없어 이 점수 불변 자체가 정규화 분기 검증은 아니다.

T는 scorer 소스·골드·같은 고정 예측이 그대로이므로 불필요하게 재실행하지 않았다. 이전 감사 11개 파일의 실행 전후 SHA256도 동일했다. 기존 산출은 변경하지 않았다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/normalization_audit.py --output runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17/normalization_audit.recheck.json
```

기존 파일은 덮어쓰지 않는다. 저장소 안 임시 디렉터리에서 새 출력 경로로 재실행해 기존 JSON과 바이트 일치를 확인했다. 새 C scorer SHA256은 `a2c4e4ca568b6811ba7ec06b1471682b893346948dd6e555f0c634b7caa7b8ad`이며 전체 원자료 해시는 JSON에 기록했다.
