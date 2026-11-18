# 판정 모델 대체 경로 정적 감사 — 2026-11-18

대상은 GanpanAI `7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d`의 최종 소스다. 상위 감사 범위는 `55f4e2534683e561561c8ae52c3ec61493a526f7..7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d` 8커밋이며, 지도 없음 보호의 교체 커밋은 그 안의 `20544d9e9edc2cb412db1428937fdf2cea55b529`다. 의뢰 근거는 Comms `84bf43db7b`다.

**결론:** 담당한 세 경로에서 고객 발화를 키워드·정규식으로 다시 판정하는 fallback은 발견하지 않았다. `needs_map`은 모델 헤드 또는 판정 모델을, `wants_image`·`wants_proposal`은 공통 판정 모델을 소비한다. 다만 이는 소스 배선 확인이다. 신규 모델의 판정 품질, 원격 판정기 등록, 실제 자산 복사·재시작·라이브 반영은 확인하지 않았다. 실패 기본 정책과 모델의 부정 판정을 구분해야 한다.

API·모델·관문·DB·운영 서비스·로그 접근, 빌드, 실험 실행은 모두 0회다. Git 객체의 코드·프롬프트·DDL·빌드 스크립트만 읽었다. 기존 평가 묶음 및 봉인 자료는 수정하지 않았다.

## 모델 출력부터 소비까지

아래 경로와 줄은 모두 대상 커밋의 `elda-orchestrator/` 기준이다.

| 경로 | 공급·전달 | 실제 소비와 실패 정책 | 주요 근거 |
|---|---|---|---|
| 지도 없음 보호 | `signals.needs_map`의 yes/no를 먼저 읽는다. null·unknown·unsure·잘못된 값이면 `judge('needs_map', question)`을 한 번 요청한다. | `toolMerge=ignore`, 이전 목록 근거 없음, 기능 on일 때만 판정한다. 최종 yes만 `noMapGuard=true`; unknown 또는 예외는 unsure이고 보호 블록을 선택하지 않는다. 고객 문자열 fallback은 없다. | `src/core/placeGate.ts:594–605`; `src/router/v1_0/chat.ts:947–954` |
| 그림 요청 | 인간의 non-serve 턴에서 `outputKindOf(question)`을 선행 시작하고 공통 `judge('wants_image', question)` 결과를 받는다. | yes → image. no/unknown/예외 → text. `why=judge:unknown`으로 불명을 남긴다. `CATEGORY_SHADOW` 분기에서 결과를 받으며, 서비스 블록에는 strong 간판 조건을 추가한다. 그림 생성에는 IMAGE_GEN, focus, ORGANIZATION 조건이 추가된다. | `src/core/categoryGate.ts:156–163`; `src/router/v1_0/chat.ts:347–349,665–676,690–703,1207–1214` |
| 제안서 요청 | IMAGE_GEN on, focus on, 기존 sign_draft가 있을 때 `judge('wants_proposal', question)`을 요청한다. | yes만 제안서 생성으로 진행한다. no/unknown/예외는 통과시키지 않는다. 제안서가 생기지 않은 뒤 wants_image=yes이면 뒤의 시안 생성 경로가 가능하지만 이는 다른 모델 판단이며 고객 키워드 fallback이 아니다. | `src/router/v1_0/chat.ts:1190–1214` |

`needsMapFromHead`는 필드 부재를 no로 만들지 않는다. `askNeedsMap`은 공통 unknown을 unsure로 바꾼다. no-map 보호에 쓰인 모델 판정과, 지도 조회 전 `placePre`에 기록하는 헤드 값은 별개다. `placePre`는 헤드가 no일 때만 조회를 닫는다(`chat.ts:624–642`).

`NO_MAP_GUARD_BLOCK`은 특정 업체의 주소·위치·연락처를 지어내지 말라는 조건부 디코더 지시다(`placeGate.ts:693–699`). 실제 디코더 메시지에는 `noMapGuard && k2Unlocalized !== 'live'`일 때만 삽입한다(`chat.ts:1316–1319`). 따라서 `no_map_guard=true`도 모든 응답 경로에서 블록 삽입을 입증하는 영수증은 아니다.

## 자산·등록·실패의 경계

- 신규 자산 `src/prompts/judge/wants_image.md`, `wants_proposal.md`는 각각 7줄이며, `JUDGE_ASKS`에 두 이름이 추가돼 있다(`judge.ts:67–68`). 프롬프트는 의미 판정을 모델에 지시하고 YES/NO 한 단어 출력을 요청한다. 예시 문장이 있다는 사실은 런타임 키워드 매처가 있다는 뜻이 아니다.
- 로컬 직접 경로는 `loadPrompt`로 자산을 읽고 system 프롬프트와 가공하지 않은 고객 원문을 모델에 전달한다(`judge.ts:282–293,346–359`). md5 앞 8자가 자산 판 표지이며, 프로세스 수명 동안 캐시한다(`promptAsset.ts:14–26`). `scripts/stamp.js:116–141`은 전체 `.md` 자산을 dist로 복사하도록 작성돼 있다. 빌드나 배포를 실행하거나 산출물을 검사하지 않았다.
- `JUDGE_DOOR_URL` 분기는 원격에 `{ask,text,cid?}`만 전송한다(`judge.ts:309–313`). 로컬의 신규 파일·enum 등록은 원격 판정기의 ask 수용·프롬프트 등록을 보증하지 않는다. 이 분기의 실제 사용 여부도 환경을 읽지 않아 미확인이다. 소스 주석 자체도 원격 자산 부재 시 `unknown(no_prompt)`를 설명한다(`judge.ts:101–110`).
- 직접 경로의 꺼짐, 빈 입력, 호출 실패, 거절, 해석 실패는 unknown 계열이다(`judge.ts:305–306,362–381`). 세 담당 축은 위험 축의 거절→yes 정책 대상이 아니므로 거절 시 unknown이다(`judge.ts:149–150`). unknown은 직접 경로 캐시에 넣지 않는다(`judge.ts:384–387`).
- `loadPrompt`는 공통 실패 정규화 전에 실행되므로 파일 누락은 `JudgeResult`를 만들기 전에 던질 수 있다(`judge.ts:283`; `promptAsset.ts:23`). 세 신규 소비 위치는 예외를 각각 null/unsure로 받으므로 고객 키워드로 돌아가지 않지만, 이 경우 공통 judge 표본이 생긴다고 보장할 수 없다.
- `proxy.judge_sample` 저작 DDL의 ask는 text이며 이 파일에는 ask enum 제한이 없다(`db/ddl/judge_sample.sql:15–20`). 공통 표본 쓰기는 pool 없음/수집 off일 때 생략하고, DB 실패는 warn만 남긴다(`judge.ts:175–199`). 실제 DB 스키마나 기록 성공을 확인한 것은 아니다.

## 보완할 관측·계약 사항

1. **그림 요청 호출 범위의 설명 불일치.** `wants_image.md:3`은 strong 간판 턴에서만 묻는다고 설명하지만, 실제 `chat.ts:348–349`는 category 결과 전에 인간 non-serve 턴에서 시작한다. IMAGE_GEN이나 CATEGORY_SHADOW가 호출 시작 조건에 없다. CATEGORY_SHADOW off 또는 category 실패이면 이미 시작된 판정을 소비하지 않을 수도 있다. 소스상 호출 범위 확인이며 지연·비용을 측정한 결론은 아니다. `categoryGate.ts:150–154`의 옛 어휘 목록 설명도 남아 있다.
2. **no-map bool만으로 unknown/no/off를 분리할 수 없다.** `chat.ts:1907,1958`은 `no_map_guard` bool만 싣고, 이 보호 판단의 `nmGuard`나 head/judge 출처는 싣지 않는다. 일부 경우 공통 judge 표본으로 복원할 수 있으나 기록은 best effort이며 보호 호출은 turnId를 넘기지 않는다. 따라서 false를 '모델이 no라 판정', '검증 통과', '보호 불필요'로 집계하면 안 된다. wants_image는 `output_why=judge:unknown`을 남겨 구별할 수 있으나 세부 unknown 사유는 상위 category 필드에 없다.
3. **공통 모델 응답 검증의 기존 한계.** 직접 파서는 시작 부분의 YES/NO 또는 마지막 줄의 YES/NO 토큰을 수용한다(`judge.ts:371–374,408–411`). 프롬프트의 정확한 한 단어 계약을 엄격히 검사하는 파서는 아니다. door 분기는 verdict의 세 값만 확인하고 stamp 전체 구조는 확인하지 않는다(`judge.ts:322–337`). stamp가 통째로 없으면 표본 쓰기에서 예외가 나거나(pool/수집 상태에 따라) provenance가 없는 verdict가 반환될 수 있다. 이는 기준 커밋에도 있던 공유 코드이며 이번 키워드 삭제가 새로 만든 회귀는 아니다. 고객 발화의 단어 판정과도 구분한다.
4. **제안서의 lane 계약은 별도 확인 대상.** wants_image에는 serve/nonHuman 제외가 명시돼 있지만 wants_proposal 위치의 조건은 IMAGE_GEN·focus·hasDraft뿐이다. 실제 그 lane에서 세 조건이 성립하는지 확인하지 않았다. '모든 그림 관련 판정이 serve에서 배제됐다'고 범위를 넓혀 주장하지 않는다.
5. **8/8을 모델 품질 증거로 쓰지 않는다.** `7d0aa049` 커밋 메시지의 '시험 8/8'은 담당자의 보고다. 변경된 `src/tools/ganpanServeGate.ts`는 기존 outputKindOf 오프라인 단언 4개를 삭제하고 모델 판정은 이 도구에서 보지 않는다고 명시한다. 새 두 질문의 정확도·기권률·실제 발동은 이 감사로 입증되지 않았다.

후속 담당자가 확인할 것은 선택된 판정 경로의 자산 존재와 판 표지, 불명 원인을 보존하는 턴 단위 관측, 새 두 의미 축의 독립 평가다. 이 감사에서는 실행하거나 새 기대값을 성적처럼 만들지 않았다.
