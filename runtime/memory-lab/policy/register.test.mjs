import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegisterContract, inspectRegister } from './register.mjs';

const casual = { name: '나래', style: { language: 'ko', tone: '친근하고 경쾌한 한국어 반말.' } };
const polite = { name: '도윤', style: { language: 'ko', tone: '차분하고 자연스러운 존댓말 해요체.' } };
const inspect = (text, persona = casual) => inspectRegister({ text, persona });
const classify = tone => classifyRegisterContract({ style: { language: 'ko', tone } });

test('explicit Korean contracts are read only from tone', () => {
  assert.equal(classifyRegisterContract(casual).register, 'casual');
  assert.equal(classifyRegisterContract(polite).register, 'haeyo');
  assert.equal(classify('자연스러운 한국어 해체').register, 'casual');
  assert.equal(classifyRegisterContract({ role: '반말', style: { tone: '차분하고 친근함' } }).register, null);
});

test('negated register mentions cannot create the opposite contract', () => {
  for (const tone of ['반말을 쓰지 않는다.', '반말 금지.', '반말이 아닌 표현.', '금지: 반말', '반말 없이 말한다.', '해요체를 사용하지 않는다.', '반말은 안 쓴다.', '반말 사용을 금한다.', '반말 사용 금지.', '해요체 사용 금지.']) {
    assert.equal(classify(tone).register, null, tone);
  }
  assert.equal(classify('반말을 쓰지 않고 해요체를 사용한다.').register, 'haeyo');
  assert.equal(classify('해요체를 쓰지 않고 반말로 말한다.').register, 'casual');
  assert.equal(classify('해요체로 말하고 반말은 쓰지 않는다.').register, 'haeyo');
  assert.equal(classify('한국어 해요체를 유지한다. 반말로 바꾸지 않는다.').register, 'haeyo');
  assert.equal(classify('해요체로 유지, 반말로 전환하지 않는다.').register, 'haeyo');
  assert.equal(classify('반말로 유지, 해요체로 변경하지 않는다.').register, 'casual');
  assert.equal(classify('반말을 섞지 않는다.').register, null);
});

test('generic polite, mixed, ambiguous or non-Korean style is unsupported', () => {
  for (const tone of ['친근한 존댓말', '반말과 해요체를 섞지 않는다.', '반말 또는 해요체', '반말처럼 편안한 존댓말', '격식 있고 공손한 말투', 'English casual', '문장을 해체해서 차근차근 설명한다.']) {
    assert.equal(classify(tone).register, null, tone);
  }
  assert.equal(classifyRegisterContract({ style: { language: 'en', tone: '반말' } }).register, null);
  assert.equal(classifyRegisterContract({}).register, null);
});

test('casual narrator with respectful endings yields exact-evidence errors', () => {
  for (const text of ['저는 나래입니다.', '작은 모양부터 만들어 봐요.', '제가 준비를 도와드리겠습니다.', '지금 한 가지만 준비하세요.']) {
    const result = inspect(text);
    assert.equal(result.repairNeeded, true, text);
    assert.equal(result.findings[0].evidence, text);
    assert.equal(result.findings[0].expected, 'casual');
    assert.equal(result.findings[0].severity, 'error');
  }
});

test('explicit haeyo contract distinguishes casual and formal sentence endings', () => {
  for (const text of ['나는 도윤이야.', '작은 모양부터 만들어 보자.', '계획을 정리할게.', '저는 도윤입니다.', '준비를 도와드리겠습니다.']) {
    assert.equal(inspect(text, polite).repairNeeded, true, text);
  }
  assert.equal(inspect('저는 도윤이에요. 작은 모양부터 만들어 봐요.', polite).repairNeeded, false);
});

test('natural casual narration remains unchanged', () => {
  for (const text of ['나는 나래야. 작은 모양부터 만들어 보자.', '일단 한 번 해. 다음은 같이 정리할게.', '해볼 수 있어. 여기서 같이 생각하자.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
});

test('quoted counterexamples do not replace narrator register', () => {
  const examples = [
    '“저는 나래입니다.”는 인용한 예문이야. 나는 나래야.',
    '"작은 모양부터 만들어 봐요."라는 초안이 있어. 같이 바꿔 보자.',
    "'시작하세요.'는 예시야. 하나씩 해 보자.",
    '「내가 도와줄게」라는 문장은 인용문이에요. 저는 도윤이에요.',
  ];
  for (let i = 0; i < examples.length; i++) {
    assert.equal(inspect(examples[i], i === 3 ? polite : casual).repairNeeded, false, examples[i]);
  }
});

test('code fences, inline code, blockquotes, tables and button labels are excluded', () => {
  const text = [
    '```text', '제가 도와드립니다.', '```',
    '~~~', '제가 도와드립니다.', '~~~',
    '`제가 도와드립니다.`',
    '> 제가 도와드립니다.',
    '| 종류 | 예시 |', '| --- | --- |', '| 격식 | 제가 도와드립니다. |',
    '버튼: 시작하세요', '- 메뉴: 시작해요', '[시작하세요]',
    '같이 준비해 보자.',
  ].join('\n');
  assert.equal(inspect(text).findings.length, 0);
});

test('noun lists and proper-name labels do not become ending mismatches', () => {
  const text = '- 준비물: 흙, 물, 수건\n- 공방\n- 도자기\n이름: 마야\n브랜드: 하나요\n제목: 같이 해요\n항목: 합니다\n목록: 마요, 하나요, 도요';
  assert.equal(inspect(text).findings.length, 0);
  assert.equal(inspect('하나요.', { name: '하나요', style: casual.style }).findings.length, 0);
});

test('grammar explanation checks narration, not quoted endings', () => {
  assert.equal(inspect('해요체는 “-아요”와 “-어요”가 쓰이는 말투야. 같이 살펴보자.').repairNeeded, false);
  assert.equal(inspect('예문: “나는 도윤이야.”\n반말의 예시를 보여 드렸어요.', polite).repairNeeded, false);
  assert.equal(inspect('“-습니다”라는 어미를 설명하는 문장이야.').repairNeeded, false);
});

test('short endings are uncertain and cannot trigger repair', () => {
  for (const text of ['좋아요.', '안녕하세요!', '합니다.']) {
    const result = inspect(text);
    assert.equal(result.repairNeeded, false, text);
    assert.equal(result.findings[0].severity, 'warning');
  }
  const result = inspect('설명은 여기에 있다.', polite);
  assert.equal(result.repairNeeded, false);
  assert.equal(result.findings[0].confidence, 'medium');
});

test('mixed narration reports only the incompatible evidence', () => {
  const result = inspect('나는 나래야. 지금 같이 준비해 보자. 다음 일정을 알려 주세요.');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].evidence, '다음 일정을 알려 주세요.');
});

test('numbered full-sentence instructions are narration; noun list items are not', () => {
  const result = inspect('1. 흙을 조금 꺼내 주세요.\n2. 준비물\n3. 작은 모양을 만들어 보자.');
  assert.equal(result.repairNeeded, true);
  assert.equal(result.findings.length, 1);
});

test('unknown language and emotion content never create a sentiment or personality verdict', () => {
  const unsupported = inspect('You are welcome.', { style: { language: 'en', tone: 'kind casual' } });
  assert.equal(unsupported.contract.supported, false);
  assert.equal(unsupported.findings.length, 0);
  const text = '걱정은 없다고 해. 여기서 정리해 보자.';
  assert.ok(inspect(text).findings.every(f => f.code.startsWith('register.')));
  assert.ok(inspect(text).limitations.some(l => l.includes('감정')));
});

test('inspection is pure and rejects invalid text explicitly', () => {
  const input = Object.freeze({ text: '저는 나래입니다.', persona: Object.freeze(casual) });
  assert.deepEqual(inspectRegister(input), inspectRegister(input));
  assert.throws(() => inspectRegister({ text: null }), TypeError);
  assert.equal(inspect('').findings.length, 0);
});

test('independent audit: indented code and explicit unquoted button labels are not narration', () => {
  assert.equal(inspect('다음은 예시야.\n    제가 도와드리겠습니다.').repairNeeded, false);
  assert.equal(inspect('다음은 예시야.\n\t제가 도와드리겠습니다.').repairNeeded, false);
  assert.equal(inspect('최종 버튼 이름은 시작하세요.').repairNeeded, false);
  assert.equal(inspect('메뉴의 표시 문구는 시작하세요.').repairNeeded, false);
});

test('formal ending grammar covers final consonant ㅂ plus 니다/니까 without a verb list', () => {
  for (const text of ['제가 준비를 도와줍니다.', '지금 이렇게 해봅니까?', '함께 방법을 알아봅니다.', '오늘 저녁에 뵙겠습니다.', '작은 도전을 해보십시오.', '자료를 여기 내려놓습니다.']) {
    for (const persona of [casual, polite]) {
      const result = inspect(text, persona);
      assert.equal(result.repairNeeded, true, text);
      assert.equal(result.findings[0].observed, 'formal', text);
    }
  }
});

test('formal grammar does not swallow other final consonants, names, labels or quotations', () => {
  for (const text of ['지명: 니다\n이름: 도와줍니다', '“제가 도와줍니다.”는 인용 예문이야.', '브랜드: 가봅니까\n최종 버튼 이름은 해보십시오.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
  assert.equal(inspect('도와줍니다.', { name: '도와줍니다', style: casual.style }).findings.length, 0);
  assert.equal(inspect('우리 지역 이름은 가니다.').findings.length, 0);
  assert.equal(inspect('그 단어는 가니까.').findings.length, 0);
  const short = inspect('도와줍니다.');
  assert.equal(short.repairNeeded, false);
  assert.equal(short.findings[0].confidence, 'medium');
});
