# Claude 재료 정책과 연구 자료 적용 범위

2026-11-18 · 클로버. 인텐터 `1190d92573`과 풀스택 `ef0edb8eca/004a00b4fc`가 전달한 사용자 결정 및 harness v1.031 H70g를 반영한다. **인코더용 Claude 재료 허용과 생성 모델 금지를 구분한다. 기존 M3는 Codex 작성 평가 전용 자료로 유지한다.**

## 내부 정책과 고정 근거

- [인텐터 정책 전문](https://github.com/ginojang/qwen25-finetune/blob/fa80438052d75ad76b45fd600fc405211c293446/intenter/notes/OPEN_RELEASE_AND_CLAUDE_MATERIAL_POLICY_v0.md): `fa80438052d75ad76b45fd600fc405211c293446`.
- [최초 harness H70g](https://github.com/ginojang/Elda-Spec/blob/137e722b2820bb8dd81bf71b1120c7e9211bddca/harness/SPEC.md#L239): `137e722b2820bb8dd81bf71b1120c7e9211bddca`, v1.030.
- [최신 harness H70g](https://github.com/ginojang/Elda-Spec/blob/e935b9c766a2e4408fd1f71650017359fc6ebd05/harness/SPEC.md#L239): `e935b9c766a2e4408fd1f71650017359fc6ebd05`, v1.031. 부모는 137e722이며 한 파일 +3/−2로 FAQ 근거를 보탰다. 위 ref의 Git 원문을 확인했다.

| 대상 | 전달된 내부 결정 |
|---|---|
| 인텐터와 인코더 기반 리소너 | Claude 라벨·재가공·틀·판정을 학습 재료로 허용. H70/H70b의 인코더 제한을 대체한다. |
| 생성 모델 | Claude 출력 증류 금지를 유지한다. |
| 엘다고 | 자기 대국과 사람·공개 자료로 학습하고 Claude는 상대·평가자로 사용한다. 구성 부품별로 인코더/생성 규칙을 적용한다. |
| 공개 묶음 | 자체 자료·코드·가중치는 MIT 공개 방침. 제삼자 자료는 원 라이선스를 유지하고, 재배포 제한 자료는 다운로드 스크립트만 제공한다. 손님 원문·실상담 기록·PII는 공개하지 않는다. |
| 품질과 출처 | 사람 정답 자료를 우선하고 Claude 재가공·라벨을 구분한다. 행별 `label_author`·`source_license`와 생성 계정·약관 종류를 출처 장부에 남긴다. |

이는 내부 정책의 기록이다. 공급자 승인·제삼자 라이선스 확인 또는 공개 완료를 뜻하지 않는다. 정책 전문은 기존 HF 모델 카드/라이선스 변경을 별도 사용자 확인 시점으로 두고 있다. 클로버의 모델 API·관문·DB·학습·배포 제한과 M3 평가 전용 조건은 유지한다. H70f 손님 말 규칙 금지·출처 확인 허용, GPU 보류도 그대로다.

## 공급자 공식 자료의 두 설명

풀스택은 H70g에 사용 정책의 사전 승인 제한과 사용자 위험 수용 결정을 함께 적었다. 11-18 공식 웹 원문에서 다음 두 설명을 확인했다.

| 공식 자료 | 확인한 설명 |
|---|---|
| [Usage Policy](https://www.anthropic.com/legal/aup), 효력 2026-11-12 | 모든 사용자 대상이며 플랫폼 남용 절에 사전 승인 없는 출력의 AI 모델 학습 사용 제한이 있다. 해당 문장에는 경쟁 모델 한정이나 인코더 예외가 없다. |
| [모델 학습 FAQ](https://support.claude.com/en/articles/12326764-can-i-use-my-outputs-to-train-an-ai-model), 표시일 2026-03-16 | 비경쟁 특화 분류·정보 추출·의미 검색 등을 허용 예시로 제시한다. 동시에 서두는 서면 허가를 요구하고, 금지 예시에 출력을 학습 표적으로 사용하는 행위를 적고 있다. |

FAQ의 허용 예시는 관련 근거지만, 더 최근 사용 정책과 함께 읽어야 한다. 공개 설명만으로 해당 계정·계약·모델 용도의 승인 여부를 확정하지 않는다. 내부 정책 허용과 공급자 승인 확인은 별도 상태로 기록한다.

06:12 UTC `004a00b4fc` 후속에서 풀스택이 FAQ를 H70g에 보탰다고 보고했다. e935b9c 원문에서 허용 예시·서두의 서면 허가·학습 표적 금지 예시를 함께 명시한 것을 확인했다. 기존 내부 결정은 유지됐으며 **규격의 근거 보완 인계는 완료**다. 사용자에게 판단을 올렸다는 담당 보고는 새로운 승인 결과로 바꾸지 않는다.

## M3 자료에서 확인한 적용 범위

| 자료 | 기존 등록 출처 | 기존 용도 | 행별 공개 필드 |
|---|---|---|---|
| [v0.1 등록](runtime/long-memory-research/eval-v0/registration.json) | OpenAI Codex GPT-6 agent, 정확한 서빙 빌드 미상, `authored_by=other_llm` | `use=eval`, `training_forbidden=true`, 사람 gold 검수 미수행 | gold 96행·scenarios 32행에 `label_author`·`source_license` 없음 |
| [v0.2 등록](runtime/long-memory-research/eval-v1/registration.json) | 위와 동일 | 위와 동일 | gold 84행·scenarios 28행에 두 필드 없음 |

이는 Claude 자료나 사람 정답 자료가 아니다. 합성 대화의 `speaker=human`은 배역이며 실제 사람이 작성·검수했다는 출처 표지가 아니다. 두 판의 gold/scenarios 네 파일은 각 manifest SHA-256과 일치했다. 봉인 파일·등록·채점기를 수정하거나 학습용으로 전환하지 않았다.

향후 공개 묶음을 만들 때는 원본을 유지한 별도 출처 파일에 `(bundle_version, source_path, source_sha256, row_id)`로 연결할 수 있다. gold의 `id`는 탐침 식별자이고 `scenario_id`가 scenarios의 `id`와 이어진다. 새 출처 표에서 기존 `other_llm`을 정책 열거값 `llm_other`로 대응하더라도 원래 작성 모델과 사람 검수 여부를 보존해야 한다. `source_license`와 생성 계정 종류는 확인 근거 없이 MIT·상업 계정으로 채우지 않는다. 출처 파일·공개 패키지 구현은 후속이다.

이번 반영은 정책·원문 확인, M3 메타데이터·해시 확인, 작업 목록 갱신이다. 모델 API·내부 관문·DB·고객 원문 접근은 0회이며 라이선스 변경·학습·공개를 실행하지 않았다.
