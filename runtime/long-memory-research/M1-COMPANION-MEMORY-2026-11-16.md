# M1 — 손님 장기기억 제품 조사
확인일: **2026-11-16 (KST)** · 범위: Character.AI, Replika, Nomi, Inworld, Convai.
방법: 공개 공식 문서·공식 블로그·공식 저장소의 정적 열람, 연구 논문 대조.
모델/API 호출, 로그인, 관문·DB 접근, 실험·테스트·운영 변경은 수행하지 않았다.
GitHub 근거는 확인일의 `main` 내용이며 커밋을 고정하지 않았다. 이 문서는 연구 제안이며 구현·도입 승인이 아니다.

## 1. 먼저 구분해야 할 것

| 근거 표시 | 의미 | 보장하지 않는 것 |
| --- | --- | --- |
| 제품 설명 | 공식 도움말·발표·정책에 쓰인 동작 | 실제 정확도, 내부 구현, 모든 버전의 동일 동작 |
| 공개 코드 확인 | 특정 공개 파일에서 읽은 함수·조건 | 서버 전체 구현, 운영 배포본, 실행 성공 |
| 개발자 발언 | 공개 Q&A에 기록된 담당자의 설명 | 독립 실측; AI 전사 요약은 원음과 대조하지 않음 |
| 연구 시연 | 논문의 조건 안에서 보고된 결과 | 조사 제품의 실제 사고나 같은 취약점 |
| 설계 제안 | 위 근거를 바탕으로 한 우리 판단 | 이미 구축·검증된 기능 |

**지속 저장, 정확한 회상, 사용자 격리, 정정 반영, 영구 삭제는 서로 다른 성질이다.**
세션 복구와 손님 식별을 분리하고, 화면에서 지운 항목이 다른 기억 층에도 전파되는지 확인해야 한다.

## 2. 제품별 비교

| 제품 | 공개된 기억 단위 | 세션을 넘는 연결 | 주요 경계 |
| --- | --- | --- | --- |
| Character.AI | Story Memory·자동 Facts·대화 이력 | 새 채팅에 Facts 복사 선택 | 복사·비활성화가 원자료 삭제를 뜻하지 않음 |
| Replika | 표시 Memory·비표시 대화 패턴 층 | 계정 기반 개인화·기기 간 동기화 | 화면 이력 기간과 서버 보관 기간이 다름 |
| Nomi | 단·중·장기기억·Shared Notes·Identity Core·Mind Map | Nomi의 개인·그룹 대화에서 장기기억 공유 | room별 Mind Map 격리를 모든 기억에 일반화하면 안 됨 |
| Inworld Realtime | 세션 facts·summary | 앱이 외부 저장 후 새 세션에 복구 | 기본 비활성 TTL 15분은 장기 보관이 아님 |
| Convai Unity 문서 | 사용자–캐릭터별 자연어 MemoryRecord | 안정적인 end_user_id를 매 접속 전달 | 기본 기기 ID는 사람의 계정 ID와 다름 |

표의 근거와 한계는 아래 각 제품의 인접 링크에 명시했다.
소비자 동반자 앱의 계정·대화방 모델을 여러 손님이 쓰는 우리 서비스의 권한 모델로 그대로 옮길 수는 없다.

## 3. Character.AI

**제품 설명 — 저장·추출·편집.** 2026-05-21 발표는 Story Memory, 자동 Facts, 대화 이력을 구분한다.
사용자 작성·고정 Story Memory는 문맥 정리 중에도 보호한다고 설명한다. Facts는 Persona·상대 Character·조연별로 나누며 추가·편집·비활성화와 조연 제거를 제공한다.
추출 모델·검색 방식·중요도 계산·실제 정확도는 공개하지 않는다. [공식 Memory 발표](https://blog.character.ai/memory/)

**재만남과 범위.** 새 채팅 시작 시 Facts를 복사하거나 새로 시작하는 선택이 있다.
이는 동일 캐릭터와의 새 채팅에 기억을 넘길지 결정하는 제품 동작이다. 계정·Persona·채팅별 내부 키나 강제 접근 통제 구현은 미확인이다. [공식 Memory 발표](https://blog.character.ai/memory/)
캐릭터 제작자가 이용자의 대화를 볼 수 없다는 공식 안내는 있지만, 이것만으로 모든 내부 처리의 격리가 입증되지는 않는다. [제작자 접근 안내](https://support.character.ai/hc/en-us/articles/15063858453659-Can-character-creators-see-my-conversations)

**정정·삭제.** Facts 비활성화와 새 채팅 초기화가 원문·추출 기억·백업 삭제까지 전파된다는 보장은 해당 발표에서 찾지 못했다.
개인정보 도움말은 정정·삭제 요청을 설명하지만 기억 저장소별 처리 기한을 제시하지 않는다. [개인정보 도움말](https://support.character.ai/hc/en-us/articles/39030432883099-Privacy-Policy)

**한계와 대응.** 2025-05-19 Chat Memories 발표는 저장 내용이 항상 그대로 사용되는 것은 아니라고 밝혔다.
2025-04 업데이트는 자동 기억의 일관성을 위한 버그 수정과 편집 기능 도입을 알렸다. 현재 오류율·개선 효과를 수치로 검증한 자료는 아니다. [Chat Memories](https://blog.character.ai/helping-characters-remember-what-matters-most/), [2025년 4월 업데이트](https://support.character.ai/hc/en-us/articles/36429196456475-Community-Update-April-2025)

**우리 시사점.** 기억 복사·초기화 선택을 세션 시작과 연결하고, 저장 성공과 응답에서의 올바른 사용을 별도 지표로 둔다.
과거의 400자·고정 메시지 수 같은 한도를 최신 제품 전체의 한도로 단정하지 않는다.

## 4. Replika

**제품 설명 — 층과 편집.** 표시 Memory 탭 외에 전체 대화의 패턴에서 개인화하는 더 깊은 층이 있다고 설명한다.
자동 생성과 수동 입력을 함께 사용하지만 비표시 층의 추출·갱신 규칙은 공개하지 않는다. 도움말의 “locally within your experience”를 단말 내 저장으로 해석할 근거도 없다. [기억 작동 방식](https://help.replika.com/hc/en-us/articles/37208679176077-How-does-Replika-s-memory-work)

**재만남.** 프로필 정보와 대화에서 배운 취향·관계가 계정 경험에 연결된다. 개인정보정책은 계정 식별 정보와 기기 간 이력 동기화를 명시한다.
공유 계정에서 여러 화자를 분리하거나 이름만으로 손님을 재식별하는 구조는 확인하지 못했다. [기억하는 정보](https://help.replika.com/hc/en-us/articles/360000874712-What-does-my-Replika-remember-about-me), [개인정보정책 §1·§2](https://replika.com/legal/privacy/en)

**정정·삭제.** 표시 기억은 추가·수정·삭제할 수 있다. 전체 대화 이력 삭제나 완전 초기화는 계정 삭제로 안내한다.
기억 하나를 지우면 비표시 층에도 같은 정보의 삭제가 전파되는지는 미공개다. [대화 삭제](https://help.replika.com/hc/en-us/articles/4410750548493-Can-I-delete-my-conversations), [초기화](https://help.replika.com/hc/en-us/articles/360020449171-How-do-I-reset-my-Replika)

**표시와 보관.** 도움말은 화면에서 최근 4개월의 대화만 볼 수 있고, 이것이 기억·성격 소실을 뜻하지는 않는다고 설명한다.
2026-10-28 정책 §6은 계정 존속 중 텍스트 24개월, 사진·영상·음성 12개월, 기억·프로필·일기 등은 계정 존속 기간 동안 보관하고 계정 삭제 후 60일 이내 삭제한다고 적는다. 법적 보존 예외도 있다. [화면 이력](https://help.replika.com/hc/en-us/articles/4411154990605-Is-the-chat-history-infinite), [보관 정책](https://replika.com/legal/privacy/en)

**실패·버전 한계.** 공식 도움말은 대명사 오류의 메시지 신고를 안내한다. 이는 오류 유형의 인정이며 발생률 자료가 아니다.
현행 약관은 classic·2.0 및 플랫폼에 따라 기억 시스템이 다르다고 명시한다. [대명사 오류](https://help.replika.com/hc/en-us/articles/360014522872-Replika-does-not-remember-my-gender), [약관 §1.5–1.6](https://replika.com/legal/terms/en)

**우리 시사점.** 기억 목록이 전체인지 일부인지 밝혀야 하며, 화면 비노출·회상 중단·서버 삭제를 서로 다른 상태로 기록한다.

## 5. Nomi

**근거 성격.** Nomipedia는 공식 지원에서 안내하는 지식베이스다. 개발자 Q&A 요약은 AI 전사 사용을 밝혀 원음과 구분한다. [공식 지원](https://nomi.ai/support/), [지식베이스](https://wiki.nomi.ai/Main_Page)

**제품 설명 — 구조.** 공식 발표는 단·중·장기기억, 사용자 Shared Notes, 자동 갱신 Identity Core를 구분한다.
Identity Core는 경험·선호·행동·피드백을 반영하며 직접 열람할 수 없다고 설명한다. Shared Notes가 이를 항상 덮어쓴다는 우선순위도 제시하지 않는다. [Identity Core 발표](https://nomi.ai/updates/introducing-the-nomi-identity-core-fostering-dynamic-and-authentic-identities/)

**요약·편집.** Mind Map은 사람·장소·주제 등의 요약 항목과 관계를 자동 구성한다. 사용자는 추가·편집·우선순위 변경을 할 수 있다.
공식 설명상 전체 기억이 아니라 기억 구조 일부의 표현이며, 각 개인·그룹 대화 room에 따로 존재한다. [Mind Map 2.0](https://nomi.ai/updates/mind-map-2-0-bringing-nomi-memory-into-view/)

**재만남·격리.** Nomi의 장기기억은 개인·그룹 대화 사이에 공유된다. Backchanneling은 최근 문맥 전달 설정이며 OFF여도 장기기억 공유를 차단하지 않는다.
따라서 room별 Mind Map 비공개를 모든 기억의 room별 격리로 바꿔 설명하면 안 된다. 여러 인간 계정 간 격리 구현의 증거도 아니다. [그룹 장기기억](https://wiki.nomi.ai/Long_term_memory_in_group_chat), [Backchanneling](https://wiki.nomi.ai/index.php?title=Backchanneling)

**정정·잊기.** Mind Map 편집은 원래 장기기억을 수정하지 않는다. 수정 항목을 잠가 자동 변경을 막을 수 있으나 원자료와 모순은 남을 수 있다.
항목은 영구 삭제 대신 Low priority로 회상 대상에서 제외하는 방식을 안내하며, 원기억은 남는다. [정정 설명](https://wiki.nomi.ai/Correcting_Mistakes_And_Editing_Mind_Map_Entries), [Low priority](https://wiki.nomi.ai/How_Do_I_Delete_Or_Remove_An_Entry_%28Low_Priority%29)

**계정 삭제.** 삭제 안내는 전체 제거를 설명하지만, 개인정보정책은 확인 후 약 28일과 통신·학습 아카이브·법적 보존 예외를 명시한다.
개별 Nomi 삭제 후 복구를 지원하는 경우도 있어 개체 삭제를 모든 데이터의 즉시 영구 삭제로 볼 수 없다. [계정 삭제](https://nomi.ai/delete-account/), [개인정보정책](https://nomi.ai/privacy-policy/), [복구 지원](https://nomi.ai/support/)

**개발자 설명상의 실패.** 2025-07-02 Q&A 요약은 그룹에서 타 Nomi에게 한 성격 피드백이 함께 반영되는 혼동 때문에 초기 Identity Core의 그룹 지원을 넣지 않았다고 설명한다.
AI 전사 기반 기록이며 현재도 발생한다거나 고객 간 누출이 있었다는 증거는 아니다. [2025년 7월 Q&A](https://wiki.nomi.ai/2025_July_Q%26A_Summary)

**우리 시사점.** 원문·추출 사실·요약·관계·페르소나 변화를 분리하고 모든 층에 화자·대상·공유 범위를 보존한다.

## 6. Inworld — 서비스 설명과 예제 코드를 분리

**현행 제품 범위.** 기존 Character Studio는 종료됐으며 공식 안내는 Portal·Agent Runtime의 템플릿으로 재구성을 설명한다.
과거 Studio의 장기기억 소개를 현재 Realtime 서비스의 지속 보관 계약으로 인용하지 않는다. [Character Studio 종료 안내](https://docs.inworld.ai/character-studio-deprecation)

**제품 설명.** Realtime은 세션에서 facts·rolling summary를 생성하지만 기본 비활성 TTL은 15분이다.
다음 주 재방문을 이어가려면 앱이 user_id로 외부 저장하고 새 세션 시작 전에 복구해야 한다. 해당 가이드는 자체 DB를 장기 상태의 정본으로 둔다. [장기기억 가이드](https://docs.inworld.ai/realtime/usage/long-term-memory)

**저장·회상 제안.** 가이드는 사용자별 facts·summary 저장과, 양이 커지면 embedding 기반 관련 기억 검색을 제안한다.
language-learning 예제가 시작 발화로 벡터 top-K를 검색한다고 설명하지만, 아래 공개 코드와 완전히 일치하지 않는다. [같은 가이드 §3](https://docs.inworld.ai/realtime/usage/long-term-memory)

**공개 코드 확인.** 확인일 main의 memory-service.ts에서 retrieve(userId, _query)는 질의를 사용하지 않고 getUserMemories(userId, 5)를 호출한다.
후자는 user_id 필터와 created_at 내림차순을 사용한다. 별도 retrieveMemories 함수에 벡터 RPC 경로는 있지만 이 retrieve 경로가 그것을 사용하지는 않는다. [공식 예제 코드](https://raw.githubusercontent.com/inworld-ai/language-learning-node/main/backend/src/services/memory-service.ts)

**확인 한계·시사점.** 이 차이는 공개 예제 함수와 가이드의 불일치이며 운영 서버 전체의 결함을 뜻하지 않는다.
예제 실행·호출 경로 전체·실제 DB 권한·삭제 전파는 확인하지 않았다. 우리 설계에서는 저장·복구 책임과 실제 검색 경로를 계약·코드·실측으로 나눠 기록해야 한다.

## 7. Convai — 사용자 식별이 기억 경계

**제품 설명.** Unity 플러그인 문서는 서버에서 사용자–캐릭터별 기억을 분리하고 새 세션 문맥에 넣는다고 설명한다.
end_user_id를 내부 speaker_id로 해석해 speaker_id:character_id 파티션을 사용한다는 것은 공식 문서의 설명이며 서버 소스 확인 결과는 아니다. [LTM 개요](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/README.md)

**재만남·식별.** 기본 제공자는 기기 식별자 또는 지속 GUID를 사용한다. 다른 사람이 같은 ID를 공유하면 기억도 공유하고 ID가 바뀌면 새 사용자로 처리된다고 경고한다.
빈 문자열·공백은 null로 정규화돼 익명 세션에서 기억을 저장·조회하지 않는다고 명시한다. 로그인 계정으로 이어가려면 앱이 안정적인 ID를 제공해야 한다. [End-User Identity](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/end-user-identity.md)

**추출·편집.** MemoryRecord는 자연어 사실과 ID·시각·메타데이터로 구성된다. 대화 중 자동 축적 외에 앱의 추가·조회·삭제를 제공한다.
추가 시 중복 사실을 병합해 최종 저장 문구가 달라질 수 있다고 설명한다. 단순 문자열 쓰기를 그대로 보존하는 계약은 아니다. [Memory Management](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/memory-management-api.md)

**삭제 범위.** Memory.DeleteAsync는 한 기억, Memory.DeleteAllAsync는 한 사용자–캐릭터 파티션을 지우며 사용자 레코드는 남긴다.
EndUsers.DeleteAsync는 사용자 레코드와 모든 캐릭터에 걸친 관련 기억을 지운다고 설명한다. 기존 세션 문맥·원문·백업·비동기 추출에 대한 삭제 전파와 완료 시간은 확인하지 못했다. [기억 삭제](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/memory-management-api.md), [사용자 삭제](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/end-user-management.md)

**우리 시사점.** 공유 장비에서는 기기 ID를 손님 ID로 쓰지 않는 설계가 필요하다. 사용자·캐릭터 범위를 삭제 화면과 감사 기록에 명확히 표시한다.
이 문서군은 beta API 변경 가능성을 명시한다. 다른 SDK나 배포 환경에 동일 동작을 일반화하지 않는다. [Beta 안내](https://github.com/Conv-AI/Convai-Documentation/blob/main/plugins-and-integrations/unity-plugin-beta-overview/features/long-term-memory/memory-management-api.md)

## 8. 실제 사고와 연구 시연

**실제 사고 — 회사 보고.** Character.AI는 2024-12-17 발표에서 홈페이지 변경 중 일부 계정 정보·채팅 등이 약 10분간 다른 사용자에게 노출됐다고 밝혔다.
회사 집계상 영향은 사용자 0.01% 미만이고 변경 절차·기술 통제를 보강했다고 설명했다. 장기기억 검색 누수로 특정할 근거는 없다. [사고 보고](https://blog.character.ai/sharing-more-about-the-recent-incident/)

**연구 시연 — MINJA.** arXiv:2503.03704v5(2026-02-12)는 정상 질의 인터페이스를 통한 기억 오염과 후속 응답 영향을 연구한다.
공유 기억 bank를 가정하며, 격리된 환경의 identity disguise는 추가 위협 가정·논의다. 이 논문은 위 다섯 제품의 실제 피해나 인증 우회 성공을 입증하지 않는다. [논문 §3·§5](https://arxiv.org/html/2503.03704v5)

**설계 해석.** 저장·검색 범위를 나누는 것과 요청자의 신원을 검증하는 것은 둘 다 필요하다.
회상된 자연어 사실을 운영 지시나 권한의 근거로 승격하지 않고, 생성된 요약의 출처·화자·추론 여부를 추적하는 연구 설계를 권한다.

## 9. 우리 설계에서 먼저 고정할 연구 질문

| 항목 | 먼저 정의할 계약 | 이후 별도 승인 시 검증할 관찰 |
| --- | --- | --- |
| 재만남 | 손님 ID·캐릭터 ID·세션 ID를 분리 | 재접속·기기 변경·동명이인에서 올바른 기억 선택 |
| 추출 | 발언·관찰·추론과 대상자를 분리 | 인용·역할극·타인 이야기를 손님 사실로 오저장하는 비율 |
| 정정 | 새 사실의 적용 시점과 이전 사실의 효력 | 요약·관계·검색 결과가 같은 정정을 반영하는지 |
| 삭제 | 비활성화·논리 삭제·영구 삭제와 처리 기한 | 원문 재추출·활성 세션·캐시에서 삭제 정보가 되살아나는지 |
| 격리 | 사용자·캐릭터·방·공유 동의의 허용 범위 | 다른 손님·다른 캐릭터 기억의 혼입 및 공개 여부 |
| 페르소나 | 손님 기억과 에이전트 정체 정본의 우선순위 | 손님 발언이 이름·정체·운영 규칙을 덮어쓰는지 |

필요한 최소 기억 속성의 **연구 제안**: 주체·대상·소유자·캐릭터·출처 메시지·기록 시각·유효 시각·추론 여부·정정 관계·삭제 상태.
저장 성공, 올바른 회상, 회상 누락, 모순, 타인 기억 혼입, 삭제 후 재등장을 각각 집계한다.
제품의 “기억한다”는 표현만으로 정확도나 격리 수준을 대신하지 않는다.

## 10. 남아 있는 확인 한계

세 소비자 앱의 DB 종류·embedding·검색 top-K·추출 프롬프트·삭제 완료 증명·계정 간 누출률은 확인하지 못했다.
Inworld는 특정 예제 파일만 코드로 대조했으며, Convai의 서버 파티션과 삭제 보장은 문서 설명이다.
공식 설명의 버전 차이와 보관 예외를 유지했고, 포럼 이용자 경험을 검증된 사고로 사용하지 않았다.
직접 인용을 최소화하고 출처별 요약을 200단어 이내로 제한했다. 코드·논문의 동작은 실행하지 않았다.
