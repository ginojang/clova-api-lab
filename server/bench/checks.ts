import type { CheckSpec } from './suite.ts';

function stripCodeFence(s: string): string {
  return s.replace(/```(?:json)?/gi, '').trim();
}

// 강제 단일 라벨 비교용 정규화: 따옴표/공백/마침표 제거.
function normalizeLabel(s: string): string {
  return s
    .trim()
    .replace(/^["'`]+|["'`.\s]+$/g, '')
    .replace(/\s+/g, '');
}

export function evaluateCheck(
  content: string,
  finishReason: string | undefined,
  check: CheckSpec,
): boolean {
  switch (check.kind) {
    case 'nonempty':
      return content.trim().length > 0;
    case 'notTruncated':
      return finishReason !== 'length' && content.trim().length > 0;
    case 'includesAny':
      return check.values.some((v) => content.includes(v));
    case 'equalsOneOf': {
      const norm = normalizeLabel(content);
      return check.values.some((v) => normalizeLabel(v) === norm);
    }
    case 'json':
      try {
        JSON.parse(stripCodeFence(content));
        return true;
      } catch {
        return false;
      }
  }
}
