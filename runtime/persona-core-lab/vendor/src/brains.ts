// 두뇌 칸(절 B) — `공급자:모델` 이름 하나로 갈아 끼운다(H8). 실행기의 다른 칸은 두뇌를 모른다.
//   scripted:<파일>               대본 두뇌(H9) — 같은 입력에 같은 출력, 돈 0. 관문을 거치지 않는다(G13)
//   eldacore:<이름>               EldaCore 두뇌 관문(brain-gateway G1) — ELDA_GATEWAY_URL · 토큰은 ELDA_GATEWAY_KEY_FILE(600)
//   openai-compat:<모델>@<주소>   OpenAI 형식 아무 곳(로컬 llama.cpp·GLM 등) — 열쇠는 ELDA_API_KEY_FILE
// 대화 기록은 안쪽에서 Anthropic 모양 블록으로 들고, OpenAI 형식 두뇌에 보낼 때만 바꾼다.
import { readFileSync } from "node:fs"

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
export interface Msg { role: "user" | "assistant"; content: Block[] }
export interface Tool { name: string; description?: string; inputSchema?: Record<string, unknown> }
export interface Usage4 { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Reply { content: Block[]; usage: Usage4; servedBy?: string; finish: "end" | "tool_use" | "length" | "refusal" }
export interface Brain {
  /** turn_end.model — 사내 주소는 빼고(H5) */
  name: string
  costBasis: "list" | "managed" | "unknown"
  complete(system: string, messages: Msg[], tools: Tool[], signal: AbortSignal): Promise<Reply>
}

/** 두뇌 API 가 HTTP 오류로 답했다 — H33 apiErrorStatus · H20 다시 하기 판단에 쓴다 */
export class ApiError extends Error {
  status: number; code: string; retryAfter?: string
  constructor(status: number, code: string, message: string, retryAfter?: string) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter }
}

const zero = (): Usage4 => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

class Scripted implements Brain {
  costBasis = "unknown" as const
  private turns: Block[][]
  name: string
  constructor(name: string, path: string) { this.name = name; this.turns = JSON.parse(readFileSync(path, "utf8")) }
  async complete(): Promise<Reply> {
    const content = this.turns.shift() ?? [{ type: "text", text: "(대본 끝)" }]
    return { content, usage: zero(), finish: content.some((b) => b.type === "tool_use") ? "tool_use" : "end" }
  }
}

class OpenAICompat implements Brain {
  name: string; model: string; base: string; keyFile: string | undefined; costBasis: "managed" | "unknown"
  constructor(name: string, model: string, base: string, keyFile: string | undefined, costBasis: "managed" | "unknown") {
    this.name = name; this.model = model; this.base = base; this.keyFile = keyFile; this.costBasis = costBasis
  }
  async complete(system: string, messages: Msg[], tools: Tool[], signal: AbortSignal): Promise<Reply> {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (this.keyFile) headers.authorization = `Bearer ${readFileSync(this.keyFile, "utf8").trim()}`   // H10 — 파일로만, 찍지 않는다
    const body: Record<string, unknown> = { model: this.model, messages: toOpenAI(system, messages), max_tokens: Number(process.env.ELDA_MAX_TOKENS ?? 4096) }
    if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } } }))
    const r = await fetch(`${this.base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal })
    const text = await r.text()
    let j: any
    try { j = JSON.parse(text) } catch { throw new ApiError(r.status || 502, "bad_response", text.slice(0, 160)) }
    if (!r.ok || j.error) {
      const st = r.ok ? Number(String(j.error?.code ?? "").slice(0, 3)) || 502 : r.status   // H20+ — 200 본문 실패도 그 코드대로
      throw new ApiError(st, String(j.error?.type ?? "api_error"), String(j.error?.message ?? "").slice(0, 160), r.headers.get("retry-after") ?? undefined)
    }
    const c = j.choices?.[0] ?? {}
    const content: Block[] = []
    if (c.message?.content) content.push({ type: "text", text: c.message.content })
    for (const tc of c.message?.tool_calls ?? []) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.function?.arguments || "{}") } catch { input = { _invalid_json: tc.function?.arguments } }   // H41 — 깨진 인자는 도구 앞에서 돌려준다
      content.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input })
    }
    const eu = j.usage?.elda_usage
    const usage: Usage4 = eu ? { input: eu.input, output: eu.output, cacheRead: eu.cacheRead, cacheWrite: eu.cacheWrite }
      : { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }
    const finish = c.finish_reason === "tool_calls" ? "tool_use" : c.finish_reason === "length" ? "length" : c.finish_reason === "content_filter" ? "refusal" : "end"
    return { content, usage, servedBy: j.model, finish }
  }
}

function toOpenAI(system: string, messages: Msg[]) {
  const out: Record<string, unknown>[] = system ? [{ role: "system", content: system }] : []
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("")
      const calls = m.content.filter((b) => b.type === "tool_use").map((b) => {
        const u = b as Extract<Block, { type: "tool_use" }>
        return { id: u.id, type: "function", function: { name: u.name, arguments: JSON.stringify(u.input) } }
      })
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      for (const b of m.content) {
        if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content })
        else if (b.type === "text") out.push({ role: "user", content: b.text })
      }
    }
  }
  return out
}

export function makeBrain(spec: string): Brain {
  const i = spec.indexOf(":")
  const kind = spec.slice(0, i), rest = spec.slice(i + 1)
  if (kind === "scripted") return new Scripted(spec, rest)
  if (kind === "eldacore") {
    const url = process.env.ELDA_GATEWAY_URL
    if (!url) throw new Error("eldacore: 두뇌는 ELDA_GATEWAY_URL 이 필요하다")
    return new OpenAICompat(spec, rest, url, process.env.ELDA_GATEWAY_KEY_FILE, "managed")   // H42 — 비용은 관문이 센다
  }
  if (kind === "openai-compat") {
    const at = rest.lastIndexOf("@")
    if (at < 0) throw new Error("openai-compat:<모델>@<주소>")
    return new OpenAICompat(`openai-compat:${rest.slice(0, at)}`, rest.slice(0, at), rest.slice(at + 1), process.env.ELDA_API_KEY_FILE, "unknown")
  }
  throw new Error(`모르는 두뇌 칸: ${kind} — scripted · eldacore · openai-compat`)
}
