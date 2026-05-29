// MySQL(clova_lab) row 형태. DECIMAL/TINYINT 은 드라이버에서 문자열/숫자로 올 수 있어 UI에서 coerce.

export type BenchRunRow = {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  temperature: string | number;
  top_p: string | number;
  repeats: number;
  prompt_count: number;
  total_calls: number | null;
  errors: number | null;
  truncated: number | null;
  latency_p50: number | null;
  latency_p95: number | null;
  avg_tok_s: string | number | null;
  total_completion_tokens: number | null;
  pass_count: number | null;
  checked_count: number | null;
  pass_rate: string | number | null;
  status: 'running' | 'done' | 'error';
  note: string | null;
};

export type BenchResultRow = {
  id: number;
  run_id: number;
  prompt_id: string;
  label: string;
  category: string;
  round: number;
  ok: number;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_sec: string | number | null;
  finish_reason: string | null;
  truncated: number;
  check_kind: string;
  check_pass: number | null;
  content: string;
  error: string | null;
};

export type BenchEvalRow = {
  id: number;
  run_id: number;
  result_id: number;
  prompt_id: string;
  category: string;
  judge: string;
  judge_model: string;
  evaluation: string;
  created_at: string;
};

export type BenchRunDetail = {
  run: BenchRunRow;
  results: BenchResultRow[];
  evaluations: BenchEvalRow[];
};
