/** Narrow Korean sentence-ending checks. This is not a personality/sentiment judge. */
const LIMITATIONS = Object.freeze([
  '명시적인 한국어 반말/해요체 계약과 일부 서술 종결형만 검사한다. 성격·공감·조롱·감정 또는 의미 정확성을 평가하지 않는다.',
  '인용·코드·표·라벨은 제외한다. 생략 문장, 고유명사와 어미의 중의성, 간접 인용, 모든 한국어 활용형을 완전히 분석하지 않는다.',
  'finding이 없다는 사실은 전체 말투 일관성의 증명이 아니다. 짧거나 모호한 어미는 warning 또는 미검출로 남을 수 있다.',
]);

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const masked = text => text.replace(/[^\n]/gu, ' ');

/** Only the operator-owned tone field supplies this contract. */
export function classifyRegisterContract(persona = {}) {
  const tone = typeof persona.style?.tone === 'string' ? persona.style.tone : '';
  const language = persona.style?.language;
  const base = { supported: false, register: null, confidence: 'unknown', evidence: tone, source: 'operator.persona.style.tone' };
  if (typeof language === 'string' && language.trim() && !/^(?:ko(?:[-_]KR)?|korean|한국어)$/iu.test(language.trim())) {
    return { ...base, reason: '명시된 언어가 한국어가 아니므로 한국어 종결형 계약을 추론하지 않는다.' };
  }
  if (!tone.trim()) return { ...base, reason: 'tone 필드에 화계 계약이 없다.' };
  const cleaned = tone.replace(/["'“”‘’「」]/gu, '');
  const mentions = [...cleaned.matchAll(/반말|해요체|해체(?=$|[\s.,;:/()]|로|를|는|의)/gu)];
  const active = [];
  for (let index = 0; index < mentions.length; index++) {
    const mention = mentions[index];
    const after = cleaned.slice(mention.index + mention[0].length, mentions[index + 1]?.index ?? cleaned.length);
    const before = cleaned.slice(Math.max(0, mention.index - 16), mention.index);
    const negativeAfter = /^(?:\s|을|를|은|는|이|가|로|만|조차|도|말투를|말투는){0,12}(?:쓰지|사용하지|말하지|대답하지|응답하지|바꾸지|변경하지|전환하지|섞지|혼용하지|하지|금지|지양|피하|배제|아니|아닌|아닐|않|없이|대신|안\s*(?:쓰|쓴|사용|바꾸|바꾼|전환)|사용(?:을)?\s*금)/u.test(after);
    const negativeBefore = /(?:금지|쓰지\s*않는|사용하지\s*않는|제외한)\s*[:：]?\s*$/u.test(before);
    const comparison = /^\s*(?:처럼|같은|이라는\s*표현|라는\s*표현)/u.test(after);
    if (!negativeAfter && !negativeBefore && !comparison) active.push(mention[0] === '해요체' ? 'haeyo' : 'casual');
  }
  const unique = [...new Set(active)];
  if (unique.length !== 1) return { ...base, reason: unique.length ? '서로 다른 화계 계약이 함께 있어 하나로 확정하지 않는다.' : '긍정적으로 명시된 반말/해요체 계약이 없다. 일반 존댓말은 해요체로 단정하지 않는다.' };
  // A bare request to avoid mixing both registers is not a positive selection.
  if (mentions.length > 1 && /(?:섞지|혼용하지|혼합하지)/u.test(cleaned) && !/(?:로\s*(?:말|답|사용)|를\s*사용)/u.test(cleaned)) {
    return { ...base, reason: '화계 혼용 금지만으로는 사용할 화계를 확정할 수 없다.' };
  }
  return { ...base, supported: true, register: unique[0], confidence: 'high', reason: 'tone 필드의 부정되지 않은 명시적 화계 계약.' };
}

function proseSegments(text) {
  // Preserve offsets so findings can quote the actual original response.
  const visible = text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, masked)
    .replace(/`[^`\n]*`|“[^”]*”|‘[^’]*’|「[^」]*」|"[^"\n]*"|'[^'\n]*'/gu, masked)
    .replace(/\[[^\]\n]*\](?:\([^\n)]*\))?/gu, masked)
    .replace(/\*\*|__/gu, '  ');
  const result = [];
  let lineOffset = 0;
  for (const line of visible.split('\n')) {
    const trimmed = line.trim();
    const ignored = /^(?: {4}|\t)|^\s*(?:>|#{1,6}\s)/u.test(line)
      || (line.match(/\|/gu)?.length ?? 0) >= 2
      || /(?:버튼|메뉴|라벨|레이블|옵션)(?:의)?\s*(?:표시\s*)?(?:이름|문구|표시|텍스트)(?:은|는|이|가)\s/u.test(line)
      || /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:버튼|메뉴|라벨|레이블|옵션|이름|제목|항목|목록|종결형|예시|예문|문구|브랜드|준비물)\s*[:：]/u.test(line)
      || /^\s*(?:[-*+]\s+|\d+[.)]\s+)?[^.!?。！？]{0,60}[:：]\s*[^.!?。！？]+$/u.test(line);
    if (!ignored && trimmed) {
      const sentence = /[^.!?。！？]+[.!?。！？]*/gu;
      for (const match of line.matchAll(sentence)) {
        const offset = lineOffset + match.index;
        let value = match[0].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '').trim();
        value = value.replace(/(?:[.!?。！？]+|[~…]+|[😊🙂😉😄😁😂🤣✨💪👍❤️])+\s*$/u, '').trim();
        if (value) result.push({ text: value, evidence: text.slice(offset, offset + match[0].length).trim() });
      }
    }
    lineOffset += line.length + 1;
  }
  return result;
}

function endingOf(sentence, persona) {
  const text = sentence.text;
  const name = typeof persona.name === 'string' ? persona.name.trim() : '';
  if (name && text === name) return null;
  // Labels and ending tokens used as grammatical subjects are not narration.
  if (/^(?:[-~]?[가-힣]+(?:체|형|어미)|반말|존댓말)(?:\s*[,/·]\s*[-~]?[가-힣]+)*$/u.test(text)) return null;
  const formal = /(?:습니다|습니까|십시오)$/u.exec(text);
  if (formal) return { register: 'formal', ending: formal[0], strong: true };
  // Hangul syllables encode the final consonant in the remainder modulo 28.
  // Jongseong index 17 is ㅂ: 줍+니다, 됩+니까, 합+니다, etc. This checks
  // a grammatical ending rather than accumulating a list of conjugated verbs.
  const contractedFormal = /([가-힣])(니다|니까)$/u.exec(text);
  if (contractedFormal && (contractedFormal[1].codePointAt(0) - 0xAC00) % 28 === 17) {
    return { register: 'formal', ending: contractedFormal[0], strong: true };
  }
  const haeyo = /(?:이에요|예요|어요|아요|해요|돼요|봐요|줘요|둬요|워요|여요|네요|군요|지요|죠|나요|까요|세요|게요|래요|대요|데요|거든요|걸요)$/u.exec(text);
  if (haeyo) return { register: 'haeyo', ending: haeyo[0], strong: true };
  const casual = /(?:이야|거야|할게|줄게|볼게|했어|됐어|없어|있어|했지|됐지|하자|보자|가자|알겠어|괜찮아|잖아|거든|지\s*마)$/u.exec(text);
  if (casual) return { register: 'casual', ending: casual[0], strong: true };
  if (name) {
    const self = new RegExp(`(?:^|\\s)(?:나는|난|저는|전)\\s+${escapeRegExp(name)}(?:이)?야$`, 'u').exec(text);
    if (self) return { register: 'casual', ending: self[0], strong: true };
  }
  const standaloneVerb = /(?:^|\s)(?:해|봐|줘|와|가)$/u.exec(text);
  if (standaloneVerb) return { register: 'casual', ending: standaloneVerb[0].trim(), strong: true };
  // A plain -다 sentence or an ambiguous -아/-어/-해 ending is only a hint.
  const ambiguous = /(?:한다|된다|이다|있다|없다|해|아|어|야)$/u.exec(text);
  return ambiguous ? { register: 'unresolved_plain', ending: ambiguous[0], strong: false } : null;
}

/** No model calls, response rewriting, sentiment labels, or mutation. */
export function inspectRegister({ text, persona = {} } = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const contract = classifyRegisterContract(persona);
  const findings = [];
  const observations = [];
  if (contract.supported) {
    for (const segment of proseSegments(text)) {
      const ending = endingOf(segment, persona);
      if (!ending) continue;
      const words = segment.text.split(/\s+/u).filter(Boolean);
      const highConfidence = ending.strong && words.length >= 2;
      observations.push({ register: ending.register, ending: ending.ending, evidence: segment.evidence, confidence: highConfidence ? 'high' : 'medium' });
      if (ending.register === contract.register) continue;
      // Plain written style is not necessarily conversational banmal. Do not
      // claim that an uncertain ending conflicts with an informal contract.
      if (ending.register === 'unresolved_plain' && contract.register === 'casual') continue;
      const expected = contract.register === 'casual' ? '반말' : '해요체';
      const observed = ending.register === 'formal' ? '하십시오체 계열 격식 종결형' : ending.register === 'haeyo' ? '해요체 종결형' : ending.register === 'casual' ? '반말 종결형' : '해요체 여부를 확정할 수 없는 평서 종결형';
      findings.push({
        code: highConfidence ? 'register.narrator_mismatch' : 'register.ending_uncertain',
        severity: highConfidence ? 'error' : 'warning', confidence: highConfidence ? 'high' : 'medium',
        evidence: segment.evidence, source: 'operator.persona.style.tone', expected: contract.register, observed: ending.register,
        rule: `${expected}가 명시된 운영자 말투에서 ${observed}이 관찰됐다.${highConfidence ? ' 인용문 밖의 서술 종결형만 계약에 맞추고 사실과 의미는 유지해야 한다.' : ' 짧거나 중의적인 문장이므로 말투 위반으로 확정하지 않는다.'}`,
      });
      if (findings.length >= 32) break;
    }
  }
  const repairNeeded = findings.some(finding => finding.severity === 'error' && finding.confidence === 'high');
  return { contract, findings, observations, ok: !repairNeeded, repairNeeded, limitations: [...LIMITATIONS] };
}
