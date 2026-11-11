import { Fault } from './common.ts';

/**
 * Native CLOVA v3 generation fields only. No credentials, transport or I/O.
 * Official references checked 2026-11-11:
 * https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3
 * https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking
 * https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-so
 *
 * HCX-007 requires maxCompletionTokens (not maxTokens). thinking.effort defaults
 * to low at the service, but this lab keeps none unless the caller opts in.
 * Both APIs document temperature 0..1. Thinking cannot accompany function calls.
 *
 * The lab's existing 1..2048 limit is intentionally preserved, even though the
 * remote models support larger outputs. This helper does not enlarge the budget
 * or infer that any other syntactically valid model exists at the provider.
 * The documented 5120/10240/20480 budgets for low/medium/high are defaults, not
 * stated minimums. A 2048-token cap can be exhausted by reasoning before a final
 * answer: callers must distinguish empty/length responses from a style failure.
 * Native structured output uses type:'json' (not the compatibility API's
 * json_schema) and is available only on 007 without thinking or function calls.
 * We check the envelope shape, not a speculative allowlist of schema keywords.
 */
export type ClovaThinkingEffort = 'none' | 'low' | 'medium' | 'high';
export type ClovaResponseFormat = { type: 'json'; schema: Record<string, unknown> };
export type ClovaGenerationOptions = { maxTokens?: number; thinkingEffort?: ClovaThinkingEffort; responseFormat?: ClovaResponseFormat };
export type ClovaGenerationConfig =
  | { maxTokens: number; temperature: 0; maxCompletionTokens?: never; thinking?: never; responseFormat?: never }
  | { maxCompletionTokens: number; temperature: 0; thinking: { effort: ClovaThinkingEffort }; maxTokens?: never; responseFormat?: ClovaResponseFormat };

export function clovaGenerationConfig(
  model: string,
  generation: ClovaGenerationOptions = {},
  toolCount = 0,
): ClovaGenerationConfig {
  if (typeof model !== 'string' || !/^(?:clova:)?[A-Za-z0-9_-]+$/.test(model)) {
    throw new Fault('configuration', 'native CLOVA model must be a model name or clova:<model>');
  }
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) {
    throw new Fault('invalid_argument', 'generation must be an object');
  }
  const maxTokens = generation.maxTokens ?? 2048;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) {
    throw new Fault('invalid_argument', 'maxTokens must be an integer from 1 to 2048');
  }
  if (!Number.isInteger(toolCount) || toolCount < 0) {
    throw new Fault('invalid_argument', 'toolCount must be a nonnegative integer');
  }
  if (toolCount && maxTokens < 1024) {
    throw new Fault('invalid_argument', 'CLOVA function calling requires maxTokens of at least 1024');
  }
  const modelName = model.startsWith('clova:') ? model.slice(6) : model;
  if (generation.thinkingEffort !== undefined && !['none', 'low', 'medium', 'high'].includes(generation.thinkingEffort)) {
    throw new Fault('invalid_argument', 'thinkingEffort must be none, low, medium, or high');
  }
  if (generation.thinkingEffort !== undefined && modelName !== 'HCX-007') {
    throw new Fault('invalid_argument', 'thinkingEffort is supported only for HCX-007');
  }
  let responseFormat: ClovaResponseFormat | undefined;
  if (generation.responseFormat !== undefined) {
    const format = generation.responseFormat;
    if (!format || typeof format !== 'object' || Array.isArray(format) || format.type !== 'json'
      || !format.schema || typeof format.schema !== 'object' || Array.isArray(format.schema)) {
      throw new Fault('invalid_argument', 'responseFormat requires type json and an object schema');
    }
    if (modelName !== 'HCX-007') {
      throw new Fault('invalid_argument', 'responseFormat is supported only for HCX-007');
    }
    if ((generation.thinkingEffort ?? 'none') !== 'none' || toolCount > 0) {
      throw new Fault('invalid_argument', 'responseFormat requires thinkingEffort none and no function calling');
    }
    try {
      responseFormat = { type: 'json', schema: structuredClone(format.schema) };
    } catch {
      throw new Fault('invalid_argument', 'responseFormat schema must be cloneable data');
    }
  }
  if (modelName === 'HCX-007') {
    const effort = generation.thinkingEffort ?? 'none';
    if (effort !== 'none' && toolCount > 0) {
      throw new Fault('invalid_argument', 'HCX-007 thinking cannot be combined with function calling');
    }
    return { maxCompletionTokens: maxTokens, temperature: 0, thinking: { effort },
      ...(responseFormat ? { responseFormat } : {}) };
  }
  return { maxTokens, temperature: 0 };
}
