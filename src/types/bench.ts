// (모델 × 프롬프트) 셀. DECIMAL/TINYINT 은 드라이버에서 문자열/숫자로 올 수 있어 UI에서 coerce.

export type BenchCell = {
  id: number;
  model: string;
  prompt_id: string;
  label: string;
  category: string;
  system_prompt: string | null;
  user_prompt: string | null;
  ok: number;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_sec: string | number | null;
  finish_reason: string | null;
  truncated: number | null;
  verdict: 'PASS' | 'FAIL' | null;
  judge: string | null;
  judge_model: string | null;
  evaluation: string | null;
  content: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SuitePrompt = {
  id: string;
  label: string;
  category: string;
  system: string | null;
  user: string;
};

export type ModelStat = { model: string; n: number };
