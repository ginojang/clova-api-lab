import { inspectResponseV2 } from './guard-v2.mjs';

// Additive observation only: no rewriting, retries, semantic success label, or
// inference that every noun after "나는" is a person's name.
const QUOTED = /~~~[\s\S]*?~~~|```[\s\S]*?```|`[^`\n]*`|“[^”]*”|‘[^’]*’|「[^」]*」|"[^"\n]*"|'[^'\n]*'/gu;
const LABEL = '[가-힣A-Za-z0-9_-]+';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalize(text) {
  // Preserve isolated labels, but mask whole quoted sentences and code.
  return text.replace(/(?<![*_])(\*\*|__|\*|_)([가-힣A-Za-z0-9_-]+)\1(?![*_])/gu, (value, marks, label) => ' '.repeat(marks.length) + label + ' '.repeat(marks.length))
    .replace(QUOTED, value => !value.startsWith('`') && new RegExp(`^${LABEL}$`, 'u').test(value.slice(1, -1))
      ? ' ' + value.slice(1, -1) + ' ' : ' '.repeat(value.length));
}

function asserted(clause, match) {
  const after = clause.slice(match.index + match[0].length);
  if (/[?？]/u.test(clause)) return false;
  if (/(?:문장|문구|예시)[^:：.!?\n]{0,30}[:：]\s*/u.test(clause.slice(0, match.index))) return false;
  if (/(?:라고|다고|다는|라며|라는)\s*(?:말|했|하|한|표현|문장|주장|쓰|적|설명)/u.test(clause)) return false;
  if (/^\s*(?:[이가은는]\s*)?(?:아니|틀렸|잘못|거짓)|^\s*(?:지\s*않|수\s*없|건\s*아니|것은\s*아니)/u.test(after)) return false;
  // Conditional and hypothetical identity examples are not adopted identities.
  return !/(?:라면|다면|라고\s*가정|예를\s*들어)/u.test(clause);
}

export function inspectIdentityClaims({ text, persona = {} }) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (typeof persona.name !== 'string' || !persona.name.trim()) return [];
  const name = persona.name.trim(), n = escape(name), findings = [];
  const visible = normalize(text);
  const clauses = [...visible.matchAll(/[^.!?。！？;\n]+[.!?。！？;\n]*/gu)];
  const add = (code, severity, confidence, evidence, rule) => findings.push({ code, severity, confidence, evidence: evidence.trim().slice(0, 500), source: 'operator.persona.name', rule });
  for (let index = 0; index < clauses.length; index++) {
    const entry = clauses[index], clause = entry[0];
    const original = text.slice(entry.index, entry.index + clause.length);
    // An immediate explicit retraction is not an adopted assertion.
    if (/^\s*(?:아니(?:요|야)(?=\s*[,!.。！]|\s*$)|(?:그|방금|앞의)\s*(?:말|자기소개)(?:은|는|가|이)?\s*(?:틀렸|잘못|거짓|사실이\s*아니))/u.test(clauses[index + 1]?.[0] ?? '')) continue;
    const explicit = new RegExp(`(?:내|제|나의|저의)\\s*이름(?:은|이)\\s*(?:이제(?:부터)?\\s*)?(${LABEL}?)\\s*(?:이에요|예요|이야|야|입니다|이라고|라고)(?=\\s|[.!?。！？;,]|$)`, 'gu');
    for (const match of clause.matchAll(explicit)) {
      if (match[1] !== name && asserted(clause, match)) add('persona.explicit_name_conflict', 'error', 'high', original,
        `운영자 이름 ${JSON.stringify(name)}과 다른 이름을 자신의 이름이라고 명시했다. 올바른 이름이 다른 부분에 있어도 이 모순은 사라지지 않는다.`);
    }
    const user = new RegExp(`(?:네|니|너의|당신의|사용자의)\\s*이름(?:은|이)\\s*(?:여전히\\s*)?${n}\\s*(?:이에요|예요|이야|야|입니다|이라고|라고)`, 'gu');
    for (const match of clause.matchAll(user)) {
      if (asserted(clause, match)) add('persona.name_subject_ambiguity', 'warning', 'medium', original,
        '운영자 이름을 사용자의 이름으로도 진술했다. 동명이인일 가능성은 이 입력만으로 배제할 수 없으므로 주체 귀속을 별도 확인해야 한다.');
    }
    const alias = new RegExp(`(${LABEL}?)\\s*(?:이)?라고\\s*(?:불러(?:도\\s*(?:돼|돼요|괜찮)|\\s*줘)|부를게)`, 'gu');
    for (const match of clause.matchAll(alias)) {
      if (match[1] !== name && asserted(clause, match)) add('persona.other_alias_ambiguous', 'warning', 'medium', original,
        '다른 호칭 사용을 허용하거나 제안하는 표현이다. 생략된 대상이 사용자·응답자 중 누구인지 확인해야 하며 정체성 성공으로 간주하지 않는다.');
    }
  }
  return findings;
}

export function inspectResponseV3(input) {
  const base = inspectResponseV2(input);
  const findings = [...base.findings, ...inspectIdentityClaims(input)];
  const repairNeeded = findings.some(f => f.severity === 'error' && f.confidence === 'high');
  return { ...base, findings, repairNeeded, ok: !repairNeeded, limitations: [...base.limitations,
    '추가 정체성 검사는 지원하는 형태의 명시적 이름 진술을 훑는다. 일반 자기 서술 명사는 검사하지 않고 호칭의 생략된 주체는 경고만 한다. 경고 또는 ok:true는 정체성 합격이 아니다. anchored-v11에서는 관찰만 하며 답변을 수정하거나 차단하지 않는다.'] };
}
