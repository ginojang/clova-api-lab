# 한국어 tiny realizer: 고정 fixture와 보호 슬롯 검사

이 폴더는 **연구·검증용**이다. 학습·배포·유료 모델 호출을 수행하지 않는다. `fixtures.json`의 20개 의미 골격 × 다정/무뚝뚝/사극 3개 말투 × 2개 표현 시도가 120개의 고정 평가 행을 만든다. 말투는 한국어 표현 방식만 지정한다. 캐릭터 정체성, 성격 전체, 화자 신분이나 관계를 주입하지 않는다.

`source`는 자연문장 의미 기준이며 `actor`, `predicate`, `protectedSlots`와 함께 모델에 제공한다. 따라서 이 실험은 키워드만 보고 역할을 복원하는 실험이 아니다. `templates`는 직접 작성한 결정론적 대체 문장으로, 독립적인 모델 생성 능력을 볼 때 프롬프트에 제공하지 않는다. 모델의 두 variant가 서로 다른 표현인지, 세 말투가 구별되는지는 별도 검토한다.

## 데이터와 고정 출력 계약

최상위 fixture에는 `schemaVersion`, `language`, `purpose`, `globalInstruction`, `styles`, `skeletons`, `plan`, `outputContract`가 있다. `styles` 키는 `friendly`, `blunt`, `historical`이며 각 값은 `label`, `instruction` 문자열이다. `plan`은 아래 출력 행에서 `text`만 없는 120개 행이다. 첫 ID는 `R01-friendly-v1`, 마지막은 `R20-historical-v2`다.

아래는 골격과 출력 행을 위한 JSON Schema 2020-12다. `skeleton`은 fixture의 각 `skeletons[]`에, `output`은 생성 결과의 각 행에 적용한다. 스키마 자체는 문자열 ID와 메타데이터의 상호 일치를 표현하지 않는다. 검사기가 해당 행의 원래 plan과 정확히 대조한다. `variant: true`는 정수 1로 취급하지 않는다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "slot": {
      "type": "object",
      "required": ["key", "type", "value", "surfaces"],
      "properties": {
        "key": {"enum": ["actor", "object", "count", "location", "time", "owner"]},
        "type": {"enum": ["person", "object", "count", "location", "time"]},
        "value": {"type": ["string", "number"]},
        "surfaces": {"type": "array", "minItems": 1, "uniqueItems": true, "items": {"type": "string", "minLength": 1}},
        "unit": {"type": "string", "minLength": 1}
      },
      "allOf": [
        {
          "if": {"properties": {"type": {"const": "count"}}},
          "then": {"required": ["unit"], "properties": {"value": {"type": "number"}}},
          "else": {"properties": {"value": {"type": "string", "minLength": 1}}, "not": {"required": ["unit"]}}
        }
      ],
      "additionalProperties": false
    },
    "predicate": {
      "type": "object",
      "required": ["lemma", "tense", "polarity", "modality", "status"],
      "properties": {
        "lemma": {"type": "string", "minLength": 1},
        "tense": {"enum": ["past", "present", "future"]},
        "polarity": {"enum": ["positive", "negative"]},
        "modality": {"enum": ["assertion", "request", "plan", "prohibition"]},
        "status": {"enum": ["completed", "ongoing", "planned", "unspecified"]}
      },
      "additionalProperties": false
    },
    "skeleton": {
      "type": "object",
      "required": ["id", "actor", "predicate", "source", "protectedSlots", "templates"],
      "properties": {
        "id": {"type": "string", "pattern": "^R(?:0[1-9]|1[0-9]|20)$"},
        "actor": {"type": "string", "minLength": 1},
        "predicate": {"$ref": "#/$defs/predicate"},
        "source": {"type": "string", "minLength": 1},
        "protectedSlots": {"type": "array", "minItems": 5, "maxItems": 6, "items": {"$ref": "#/$defs/slot"}},
        "templates": {
          "type": "object", "required": ["friendly", "blunt", "historical"],
          "properties": {
            "friendly": {"type": "string", "minLength": 1},
            "blunt": {"type": "string", "minLength": 1},
            "historical": {"type": "string", "minLength": 1}
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "output": {
      "type": "object",
      "required": ["id", "skeletonId", "style", "variant", "text"],
      "properties": {
        "id": {"type": "string", "pattern": "^R(?:0[1-9]|1[0-9]|20)-(?:friendly|blunt|historical)-v[12]$"},
        "skeletonId": {"type": "string", "pattern": "^R(?:0[1-9]|1[0-9]|20)$"},
        "style": {"enum": ["friendly", "blunt", "historical"]},
        "variant": {"type": "integer", "enum": [1, 2]},
        "text": {"type": "string", "minLength": 1},
        "provenance": {"enum": ["model_raw", "offline_reference", "deterministic_template"]},
        "fallbackReason": {"type": "object"}
      },
      "additionalProperties": true
    }
  },
  "type": "array",
  "items": {"$ref": "#/$defs/output"},
  "minItems": 120,
  "maxItems": 120
}
```

출력은 다음 배열 또는 `{ "outputs": [...] }` wrapper를 받는다. 생성 API가 `id`, `text`만 반환한다면 실행기가 **원래 plan의** 나머지 필드를 결합하고 텍스트는 수정하지 않는다.

```json
[
  {
    "id": "R01-friendly-v1",
    "skeletonId": "R01",
    "style": "friendly",
    "variant": 1,
    "text": "민은 어제 도서관에서 책 세 권을 빌렸어요."
  }
]
```

위 한 행만 제출하면 나머지 119행은 누락으로 실패한다. 빈 배열, 모델 호출 없음, 빈 텍스트를 성공으로 채우지 않는다. 스키마 예시는 계약 문서이며 실행기는 외부 JSON Schema 라이브러리 없이 필수 출력 구조, ID 결합, 완전성을 직접 확인한다. fixture 로더는 고정 차원·plan 무결성을 확인하며 일반 목적의 완전한 스키마 검증기는 아니다.

`status=completed`는 과거 긍정 행동, `ongoing`은 진행 중 행동, `planned`는 명시된 예정에 사용한다. 부정 과거와 요청·금지의 결과 상태는 `unspecified`다. 요청·금지의 `tense=future`는 요청 대상 행동의 시간이며, 그 행동이 실제 실행되거나 계획으로 확정됐다는 뜻이 아니다. 소유자 `owner`는 `person` 타입의 추가 보호 슬롯이다.

## 검사 범위

`slot-check.py`는 Python 3 표준 라이브러리만 사용한다. NFC 정규화 후 공백을 정리하며, 실제 모델 출력 파일은 바꾸지 않는다. 보호 슬롯은 **명시적으로 열거된 표기만** 허용한다.

| 항목 | 허용 | 거절 또는 범위 밖 |
| --- | --- | --- |
| 이름 | `민`, `민은`, `민이`, `민 은` 등 유한 조사 목록 | `민수`를 `민`으로 인정하지 않음. 새 이름은 fixture 내 통제 어휘에 있을 때 검출 |
| 명사/장소 | `도서관`, `도서관에서`, `도서관에서는` | `도서관장`을 `도서관`으로 인정하지 않음. 동의어 자동 확장 없음 |
| 수량 | 슬롯별 `3권`/`세 권`; 수·단위 사이 공백 | `13권`, `03권`, `3.0권`, `-3권`, `3장`으로 대체하면 실패 |
| 단위 | 명시한 `500mL`/`500밀리리터`/`오백 밀리리터` | `0.5L`가 같은 양이어도 미등록 표기여서 거절 |
| 돈 | 해당 슬롯의 `3000원`/`3,000원`/`삼천 원` | `30,00원` 등 임의 쉼표 변환 거절 |
| 시간 | 해당 슬롯의 `오후 3시`/`오후 세 시`/`15시`/`15:00` | `오전 3시`, 미등록 12시간 표기, 추가 `30분` 거절 |
| 추가 보호 값 | fixture 전체의 사람·사물·장소·시간·수량 통제 어휘와 대조 | 열린 어휘의 모든 신규 명사/사실을 검출하지 않음 |
| 추가 숫자 | 보호된 수량·시간 밖 아라비아 수, 제한된 한글 수사+단위 | 모든 한국어 수 표현/분수/관용어를 해석하지 않음 |
| 극성 | `지 않/못/말`, 독립 `안/못` 등 제한적 단서 | 부정 범위·이중부정·함축은 판정하지 않음 |

정규식 앞뒤의 단어 경계와 전체 수·단위 표기를 검사해 부분 문자열 일치로 성공시키지 않는다. `은`은 실제 이름이기도 하므로 `민 은`에서 다른 보호 토큰의 조사 부분에 들어간 후보를 제거한다. `공원`은 통제된 장소 토큰이므로 숫자 `공(0)`+화폐 단위 `원`으로 오인하지 않는다. 이 처리는 이 고정 어휘의 모호성을 다루는 제한된 규칙이다. 형태소 분석, 일반 개체명 인식 또는 완전한 한국어 문법 판정을 주장하지 않는다.

## 의미 검토는 항상 필요

`lexicalPass=true`는 보호 표기 검사와 제한적 극성 단서를 통과했다는 뜻이다. **의미 보존, 사실 무추가, 말투 적합성의 증명이 아니다.** 모든 결과는 `semanticReviewRequired=true`, `semanticVerdict="unreviewed"`를 유지하며 `semanticAccepted=0`이다. 자동 검사기는 수동 의미 승인 값을 만들지 않는다.

검토자는 원래 `source`와 typed skeleton을 보고 행위자/대상/소유 관계, 술어, 시제·진행/완료/예정, 부정 범위, 요청/금지/진술의 양태, 증거 출처·확신도, 새 사실/감정/관계, 말투와 변형의 실제 차이를 확인해야 한다. 단순한 긍정↔부정 전환은 잡을 수 있지만 아래 오류는 어휘 검사에 통과하며 테스트에 명시해 두었다.

- `영희 ... 민의 우산`을 `민 ... 영희의 우산`으로 바꾸기: 이름은 보존되나 역할이 뒤집힌다.
- `내일 ... 가져올 예정이다`를 `내일 ... 가져왔다`로 바꾸기: 시제·상태가 바뀐다.
- `제출해 주세요`를 `제출했어요`로 바꾸기: 요청이 완료 보고로 바뀐다.
- `빌렸어요`를 `빌렸다고 들었어요`로 바꾸기: 증거 출처가 추가된다.
- 통제 어휘 밖 사람 `가람`을 추가하기: 열린 어휘 인식 범위 밖이다.
- 부정 행동을 긍정 행동으로 바꾸고 뒤에 `기쁘지 않았어요`를 붙이기: 부정 단서는 있으나 범위가 틀리고 감정도 추가된다.

## 실행과 결과 해석

```bash
python3 runtime/realizer/tests/test_slot_check.py --result runtime/realizer/offline-tests.json
python3 runtime/realizer/slot-check.py check runtime/realizer/teacher-outputs.json --report runtime/realizer/teacher-slot-check.json
python3 runtime/realizer/slot-check.py fallback runtime/realizer/teacher-outputs.json --output runtime/realizer/teacher-with-fallback.json
```

`check` 종료 코드는 120행의 제한된 검사 전부 통과 시 0, 검사 실패 시 1, 읽기/JSON/fixture 오류 시 2다. 종료 코드 0은 의미·말투 승인을 뜻하지 않는다. 없는 입력 파일을 빈 성공 결과로 간주하지 않는다. 중복 ID는 해당 행도 실패시키며, 알 수 없는 ID와 잘못된 컨테이너는 입력 오류로 전체 통과를 막는다. 스타일/골격/variant는 ID에 결합된 원래 plan과 타입까지 일치해야 한다.

`fallback`은 검사가 실패한 행과 누락 행을 그 골격·말투의 직접 작성한 문장으로 교체한다. 템플릿은 원래 사실과 종결어미만 사용하며 외부 데이터를 조회하지 않는다. 두 variant가 같은 템플릿을 사용하는 것은 의도적이다. 이 대체 문장으로 모델 다양성을 주장하지 않는다. 어휘 검사를 통과한 의미 오류는 자동 대체되지 않으므로 의미 검토가 계속 필요하다.

결과에는 `rawSummary`, `rawInputErrors`, `finalSummary`와 행별 `provenance`가 있다. `rawModelLexicalPass`와 `fallbackCount`를 반드시 분리해 인용한다. 입력 오류도 보존하므로 대체 출력의 120/120 통과로 잘못된 원본 형식을 숨기지 않는다. `offline_reference`와 `deterministic_template`은 모델 원문 성공 수에서 제외한다. provenance는 로컬 평가 메타데이터이며 생성 출처를 암호학적으로 인증하지 않는다. raw 성공률의 분모는 항상 계획된 120행이다.

오프라인 기준 문장은 다음 명령으로 다시 만들 수 있다.

```bash
python3 runtime/realizer/slot-check.py references --output runtime/realizer/offline-reference-outputs.json
python3 runtime/realizer/slot-check.py check runtime/realizer/offline-reference-outputs.json --report runtime/realizer/offline-slot-check.json
```

`offline-reference-outputs.json`은 사람이 작성한 60개 템플릿을 plan의 120개 행에 배치한 오프라인 점검 자료다. 실제 teacher 출력이나 모델 성공 사례가 아니다. `offline-tests.json`은 적대적 경계 사례 51개, 기준 문장의 어휘 검사 120/120, 모델 출력 없음의 raw 성공 0/120, 빈 모델 출력의 템플릿 대체 120개를 별도로 기록한다.
