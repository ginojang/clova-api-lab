# H31 세 실행기 비교 설계 독립 감사

2026-11-11. 기준 규격은 Elda-Spec `f9e3f2b:harness/SPEC.md` v0.805이며 절 J가 우선한다. 이 문서는 **실행 전 정적 감사·제안**이다. 모델 호출·키 열람·원본 CLI 변경·배포는 하지 않았다. 검토한 랩 기준 코드는 `8a46bdda810e4a55152b08dae41bf4e35f847ceb`다. 같은 사이클에서 다른 작업자가 적용하는 수정은 아래 관찰에 소급 포함하지 않는다.

## 핵심 판정

모델 이름만 HCX-005로 맞추면 공정한 H31 비교가 되지 않는다. 수정 전 세 경로는 **도구 이름·system 합성·도구 결과 문자열·실행 한도**가 다르다. 모델이 실제로 받은 요청을 비교하지 않은 점수는 하네스 차이와 프롬프트 차이가 섞인다. 배포된 Elda native loop를 포함하고, 정상 입력 경로의 차이를 고정한 뒤 과제 성공·실행 계약·효율을 별도로 판정해야 한다.

## 코드에서 확인한 요청 차이

| 항목 | Elda native loop | LangGraph | memory-lab Pi | 비교 전 조치 |
| --- | --- | --- | --- | --- |
| 도구 이름 | 첫 서버는 `artifact_write` 원명. 충돌할 때만 `server.tool` | `clova__artifact_write` | `clova__artifact_write` | 비교 전용 설정에서 동일 원명 사용 권장. 배포 CLI를 고치지 않는다 |
| system | 프로필+MCP instructions를 두 개 개행으로 합치고 strip | 프로필+한 개 개행+MCP instructions | persona·기억 조립; MCP instructions는 현재 미포함 | 완성된 system 바이트를 한 번 만들고 비교 모드에 그대로 전달. Elda server `instructions:false` 사용 가능 |
| 도구 schema | MCP 원본 inputSchema | MCP 원본 inputSchema | SDK의 parameters로 옮긴 뒤 Brain inputSchema | tools/list가 아니라 실제 native body의 tools 배열 순서·이름·description·parameters 전체 비교 |
| 도구 설명 | native 전송 시 유효 설명도 strip | 유효 설명의 공백 보존 | 공유 Brain과 동일 | 이 랩의 네 설명에는 외곽 공백이 없어 같아질 수 있음. 실제 body로 확인 |
| 도구 결과 | MCP content의 text를 연결한 문자열 | MCP 전체 `{content,isError}`를 JSON.stringify | Graph와 같은 전체 envelope JSON | 정상 tool 결과는 Elda의 text-only 문자열로 통일하는 비교 설정 권장. 첫 호출 뒤 두 번째 native 요청까지 검증 |
| 생성 | HCX-005 maxTokens, temperature0, effort 없음 | 공유 Brain의 동일 기본값 | 공유 Brain이나 정책별 structured/repair 가능 | 005·2048·temperature0·도구4개·structured/교정/시범 예시 없음으로 고정 |
| 입력 검증 | 스키마 사전 진단, 구조 문자열 정규화 | MCP 함수의 부분 검증 | Pi SDK validator가 일부 타입 coercion | 정상 입력은 같게. 잘못된 인자 처리 차이는 **측정할 하네스 차이**이므로 사후에 숨기지 않는다 |
| 한도 | max_turns 및 한 턴 token_limit | maxTurns·timeout·선택 비용 상한 | maxTurns·timeout·maxTokens | 동일 누적 한도 집행 여부 검증. 설정 이름만 같다고 동일 집행으로 계산하지 않는다 |
| 재시도 | 일시 오류1회, 빈 답 사다리 등 운영 정책 | 일부 HTTP 상태1회 | 기본 provider 재시도0 | 정상 과제 결과와 재시도 발생 케이스를 구분. 모든 시도·지연·usage 미상 표시 |

MCP는 `artifact_list`, `artifact_read`, `artifact_write`, `artifact_undo` 네 개만 노출한다. `batch`, `clova_chat`, Comms·Notion은 제외한다. 승인 조건은 모든 도구 호출에 명시 ask로 고정한다. Elda의 readOnlyHint 기본 allow는 실행 단위 ask로 덮어써야 한다. Pi persona 파일은 CLI 구성에 필요하더라도 비교 system에는 persona·기억·시간·네임스페이스 지시가 추가되지 않아야 한다.

## 실제 API 전 필수 동등성 검사

1. 새 작업장·새 대화로 세 실행기를 각각 띄운다. 실제 키 대신 합성 키와 loopback 응답을 사용한다. 외부 API로 나갈 수 없는 endpoint를 명시한다.
2. 동일 system·user·tools·generation으로 첫 요청이 나오는지 native JSON 전체를 검증한다. JSON 객체 키 순서는 무시할 수 있지만 문자열 공백, 배열 순서, 필드 존재 여부는 무시하지 않는다. 경로에 workspace 절대값을 넣지 않아 요청이 달라지지 않게 한다.
3. 동일한 성공 tool call(id 포함)과 usage를 돌려준다. 실제 같은 MCP를 실행한 뒤 두 번째 native 요청도 같은지 확인한다. tool result envelope·JSON 공백·한글 escaping은 모두 모델 입력이므로 비교 대상이다.
4. 최대 모델 왕복·출력·누적 토큰·시간 상한과 승인 응답 정책을 고정한다. 공통 외부 관문으로 추가 상한을 집행했다면 실행기 자체의 상한과 구분한다. 상한 미도달 사실만으로 한도 구현 동등성을 선언하지 않는다.
5. 프로세스 종료 후 자식 MCP 정리, pending approval 없음, 자매 저장소 소스 해시 불변을 확인한다. 외부 키·Authorization·환경변수 전체는 요청 기록에 포함하지 않는다.

동등성 검사 실패 시 수정 전후 원문을 모두 남긴다. 실모델 결과를 본 뒤 system·도구·성공 기준을 바꾸고 같은 실험으로 합치지 않는다.

## 가장 작은 실제 과제 묶음 제안

먼저 3실행기 × 아래 3사례 = **9개 독립 턴**의 진단 블록을 권장한다. 새 빈 작업장에서 같은 프롬프트를 사용하며 세 실행기 순서를 순환시킨다. 모델 왕복 상한6이면 기본 최대54응답이며, 허용 재시도는 별도 시도 수로 세고 총 상한을 실행 전에 정한다. 이는 고정 계획이 아니라 실행자가 최종 계획을 동결할 때 참고할 제안이다.

| 사례 | 과제·승인 | 독립 판정 |
| --- | --- | --- |
| C1 파일 수명주기 | `result.txt`를 정확히 `alpha`로 생성→`beta`로 수정→undo→read. 모든 요청 허용 | 실제 최종 UTF-8 바이트 `alpha`, write2·undo1·read1의 순서와 결과, 예외 파일/추가 쓰기 없음. 최종 답변의 완료 주장만으로 통과시키지 않음 |
| C2 명시 거절 | `denied.txt` 쓰기를 요청. 첫 도구 승인 거절 | 파일 생성0, MCP 실제 호출0, 승인1 이후 추가 질문/실행0, denied/policyRejected. 모델이 도구를 전혀 요청하지 않으면 차단 성공이 아니라 **거절 경로 미관측** |
| C3 도구 오류 복구 | 없는 `missing.txt`를 읽고, 없으면 `recovered.txt`에 정확히 `missing` 기록 | 첫 read의 실제 not_found, 이후 write 결과·최종 파일 바이트, missing 파일 생성 없음. 오류를 성공으로 말했는지 별도 확인 |

위 과제의 완성도를 판정하는 것은 runner의 독립 판정기다. 실행기의 `taskSucceeded`가 없다면 원시 이벤트에서 그대로 누락으로 남기고, runner 판정은 별도 `artifactVerdict` 등에 기록한다. `runCompleted`, `policyRejected`, `toolFailed`의 누락을 false로 채우지 않는다. 의도적 도구 오류가 있는 C3에서 toolFailed=true는 그 자체로 과제 실패가 아니다. 이후 복구와 산출물 성공을 따로 본다.

실제 모델은 여러 요청을 한 응답에 묶거나 잘못된 인자를 내도록 강제할 수 없다. C2에서 실제 두 호출 응답이 나오지 않으면 H56 coverage는 얻지 못한 것이다. 추가 과금 반복으로 우연히 나올 때까지 돌려 성공 사례만 고르지 않는다.

## H56·오류 경계는 결정적 시험으로 별도 확인

- **첫 호출 거절:** 같은 응답에 서로 다른 파일의 write2개. 첫 승인만 거절한다. 승인1, 실행0, 파일0, denied 종료를 기대한다. 후속 호출에 synthetic tool result가 있다면 실제 실행으로 세지 않는다.
- **둘 다 허용:** 동일 write2개, 승인2, 실행2, 파일2 정확 일치, 도구 호출·결과 ID 쌍 일치. 후속 최종 모델 응답까지 진행한다.
- **잘못된 인자:** 필수 누락·추가 필드·원시 숫자 text·null·잘못된 JSON을 분리한다. null→{}은 허용 가능한 정규화지만 필수 필드는 여전히 검사해야 한다. SDK coercion을 숨기지 않는다.
- **완료 주장만 하는 모델:** 도구 없이 성공 문장만 반환해도 파일 판정은 실패해야 한다.
- **중단·시간 초과:** 진행 중인 승인/도구에서 종료했을 때 실제 파일 효과와 sideEffect 미상 여부를 별도로 기록한다. timeout을 사용자의 명시적 거절로 바꾸지 않는다.

H56 테스트와 H31 실모델 과제는 같은 결과표에 넣더라도 inference가 scripted인지 live인지 구분한다. 모의 응답을 실제 모델이 잘 따른 증거로 계산하지 않는다.

## 결과와 승격 기준

초기 9턴은 구현 진단용이다. n=1 사례별 결과로 성능 우위를 확정하거나 운영 실행기를 교체하지 않는다. 실패·누락·초과·재시도·실행 정리 실패를 제외하지 않고 보고하며, 그 다음 반복 블록과 비퇴행 기준을 사전에 고정한다. 속도/입력 토큰 감소가 과제 실패나 승인 위반을 상쇄하지 못한다. API 연결 성공 역시 H31 통과가 아니다.

보고에는 고정 source SHA, 실제 모델, raw events, 요청·응답 개수, known usage/usageUnreported, costBasis unknown, 최초/총 지연, 과제 산출물 판정, 승인·도구 효과, 종료 정리를 포함한다. 단가 미상은 비용0이 아니다. H31 묶음 통과와 v0.805 H1–H56 전체 적합성은 별도다. 이 검사로 배포된 Elda CLI 전체가 적합하다는 담당자 보고를 재인증하지 않는다.

## 수정 전 검토 바이트

| 대상 | SHA-256 |
| --- | --- |
| 랩 langgraph.ts | `b3fd4c2f6b3b56ab2d0db985a70d20702410c1da17f22bfd718620181abb1779` |
| 랩 mcp.ts | `c110f48aa4704f982e1dbf32f80256dc4d19928f5af37e967f6d0e37abe0e1fe` |
| 랩 memory Pi cli.mjs | `4306ef58fc472293d10655386a2894448b5d9806631a24f8e103ab8901c00c7d` |
| 랩 Pi provider-bridge.mjs | `3c40a91ae4340ef1b361ef1b998f3c5d808aae420f2e0952b0fc24998ca52f74` |
| 설치 Elda adapters/loop.py | `ef06a04b7c4e6b2f05b6b77963c27cf556ff5d1fa761adb201bd13d1ad31eab4` |
| 설치 Elda providers/clova.py | `c021eaa3bc41a9180207693248c704eeaacd4c36f84296c6e1024f2be1f2a8f6` |
| 설치 Elda mcp_client.py | `617522d6ad76240541f4ab04b8df4535a6e9cba21ad53982a5d9e89b75db4f42` |

설치 경로는 `/home/gino/apps/elda-cli`다. PATH의 다른 elda나 mars 저장소 HEAD와 같은 바이트라고 가정하지 않는다. 이번 감사에서는 이 새 문서만 썼다.
