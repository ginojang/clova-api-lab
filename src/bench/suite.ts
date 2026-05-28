// 진단/벤치용 프롬프트 세트. CLAUDE.md 테스트 세트 기반 + 자동 판정 기준.
// 판정은 단순/결정적 휴리스틱이다(완전한 eval 아님 — 명백한 깨짐만 잡는다).

export type CheckSpec =
  | { kind: 'nonempty' } // 응답이 비어있지 않은가
  | { kind: 'json' } // 코드펜스 제거 후 JSON 파싱되는가
  | { kind: 'includesAny'; values: string[] } // 기대 라벨/토큰 포함
  | { kind: 'equalsOneOf'; values: string[] } // 정규화 후 라벨과 정확히 일치(강제 단일 라벨 지시 준수 검증)
  | { kind: 'notTruncated' }; // finishReason !== 'length'

export type BenchPrompt = {
  id: string;
  label: string;
  category: string;
  system?: string;
  user: string;
  maxTokens?: number;
  check: CheckSpec;
};

export const BENCH_SUITE: BenchPrompt[] = [
  {
    id: 'chat-basic',
    label: '일반 대화',
    category: '대화',
    user: '한국의 가을 날씨를 두 문장으로 설명해줘.',
    maxTokens: 120,
    check: { kind: 'nonempty' },
  },
  {
    id: 'honorific',
    label: '반말 변환',
    category: '변환',
    system: '너는 문체 변환기다. 의미를 바꾸지 말고 문체만 바꿔라.',
    user: "다음 문장을 반말로 바꿔라. 결과 문장만 출력: '오늘 회의는 오후 세 시에 시작합니다.'",
    maxTokens: 60,
    check: { kind: 'nonempty' },
  },
  {
    id: 'summary',
    label: '문서 요약',
    category: '요약',
    user:
      '다음 글을 한 문장으로 요약해줘: "인공지능 모델의 성능은 파라미터 수뿐 아니라 학습 데이터의 質과 다양성, 그리고 정렬(alignment) 방식에 크게 좌우된다. 최근에는 작은 모델도 정교한 튜닝으로 큰 모델에 근접한 성능을 낸다."',
    maxTokens: 120,
    check: { kind: 'notTruncated' },
  },
  {
    id: 'sentiment',
    label: '감정 분류',
    category: '분류',
    system: "감정 분류기. 반드시 '긍정' '부정' '중립' 중 한 단어로만 답하라.",
    user: '문장: "배송이 너무 늦고 포장도 엉망이었어요." 감정은?',
    maxTokens: 10,
    check: { kind: 'equalsOneOf', values: ['부정'] },
  },
  {
    id: 'intent',
    label: '의도 분류',
    category: '분류',
    system: "의도 분류기. '주문' '취소' '환불' '문의' 중 한 단어로만 답하라.",
    user: '발화: "어제 산 신발 반품하고 돈 돌려받고 싶어요." 의도는?',
    maxTokens: 10,
    check: { kind: 'equalsOneOf', values: ['환불', '취소'] },
  },
  {
    id: 'json-strict',
    label: 'JSON 강제',
    category: 'JSON',
    system: '너는 JSON 생성기다. 코드블록/설명 없이 순수 JSON만 출력한다.',
    user: '다음을 JSON으로: 이름은 홍길동, 나이는 30, 도시는 서울. 키는 name, age, city.',
    maxTokens: 80,
    check: { kind: 'json' },
  },
  {
    id: 'code-gen',
    label: '코드 생성',
    category: '코드',
    user: 'Python으로 두 정수의 최대공약수를 구하는 함수 gcd(a,b)를 작성해줘.',
    maxTokens: 200,
    check: { kind: 'includesAny', values: ['def', 'return'] },
  },
  {
    id: 'long-context',
    label: '긴 문맥 유지',
    category: '문맥',
    system: '지시를 끝까지 기억하라.',
    user:
      '중요 코드는 7421이다. 아래는 무시해도 되는 잡담이다: ' +
      '오늘 점심으로 김치찌개를 먹었고 날씨가 흐렸으며 버스가 조금 늦게 왔다. ' +
      '커피를 두 잔 마셨고 오후에는 회의가 길어졌다. '.repeat(6) +
      '자, 맨 처음 알려준 중요 코드는 무엇이었지? 숫자만 답하라.',
    maxTokens: 20,
    check: { kind: 'includesAny', values: ['7421'] },
  },
  {
    id: 'culture',
    label: '한국 문화 문맥',
    category: '문화',
    user: '한국에서 설날에 어른께 세배를 하면 무엇을 받는지 한 문장으로 답해줘.',
    maxTokens: 80,
    check: { kind: 'includesAny', values: ['세뱃돈', '세배돈', '덕담', '용돈'] },
  },
];
