// 끼어드는 자리(H19) — 이름·시점·입출력은 Claude Code 훅 계약(H36)을 따른다.
// ★ EldaCore 가 값을 더하는 곳이 여기다. 루프(main.ts)는 고치지 않고 이 넷만 채운다:
//   UserPromptSubmit = 턴 앞 — 페르소나·기억 맥락 주입(R4 before_turn)
//   PreToolUse       = 도구 앞 — 인자 검사·고치기·막기
//   PostToolUse      = 도구 뒤 — 측정·판정을 모델에게 싣기
//   (UserPromptSubmit 이 decision:"block" + reason 을 내면 = 두뇌 없이 그 글을 손님 답으로 낸다 — 정해진 거절·결정론 답, v0.815)
//   Stop             = 턴 뒤 — 일관성 판정: 통과 / 막고 이유를 돌려줘 고치게(R10 after_turn)
// 구현은 ELDA_HOOKS 로 갈아 끼운다. 없으면 아무것도 안 한다.
//   ELDA_HOOKS=<.json>  Claude Code settings 의 hooks 모양 그대로(Elda CLI b632690 과 같다, v0.817):
//     {"UserPromptSubmit":[{"hooks":[{"type":"http","url":"http://127.0.0.1:3200/api/v1_0/turn/before","timeout":8}]}],
//      "PreToolUse":[{"matcher":"text_add|batch","hooks":[{"type":"command","command":"./check.sh"}]}]}
//     command = stdin 에 입력 JSON · 종료 0 = stdout JSON(빈 출력 = 결정 없음) · 종료 2 = 막음(stderr = 이유) · 그 밖 = 실패
//     http    = 입력 JSON 을 POST · 2xx 본문 JSON 이 출력
//     한 자리에 여럿이면 차례로 부르고 합친다: block 이 이기고 · deny > ask > allow · 맥락은 이어 붙이고 · 바꾼 값은 뒤가 이긴다
//   ELDA_HOOKS=<.ts/.js 모듈>  아래 이름으로 함수를 내보내는 모듈(같은 프로세스 — 시험·본보기용)
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export interface HookBase { session_id: string; cwd: string; hook_event_name: string }
export interface Out {
  continue?: boolean
  stopReason?: string
  decision?: "block"
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: {
    hookEventName: string
    additionalContext?: string
    permissionDecision?: "allow" | "deny" | "ask" | "defer"
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    updatedToolOutput?: string
    /** ★ Elda 확장(v0.815) — UserPromptSubmit 만: 이 턴만 쓸 두뇌 칸(예 "eldacore:judge"). 입구가 정한 허용 목록(ELDA_BRAIN_ALLOW) 안에서만 듣는다 */
    brain?: string
  }
}
export interface Hooks {
  UserPromptSubmit?(i: HookBase & { prompt: string }): Promise<Out | void>
  PreToolUse?(i: HookBase & { tool_name: string; tool_input: Record<string, unknown>; tool_use_id: string }): Promise<Out | void>
  PostToolUse?(i: HookBase & { tool_name: string; tool_input: Record<string, unknown>; tool_use_id: string; tool_response: string; duration_ms: number }): Promise<Out | void>
  PostToolUseFailure?(i: HookBase & { tool_name: string; tool_input: Record<string, unknown>; tool_use_id: string; error: string; duration_ms: number }): Promise<Out | void>
  /** stop_hook_active 가 참이면 다시 막지 않는다 — 무한 반복 방지(H36) */
  Stop?(i: HookBase & { stop_hook_active: boolean; last_assistant_message: string }): Promise<Out | void>
}

const TIMEOUT_MS = Number(process.env.ELDA_HOOK_TIMEOUT_MS ?? 60000)
/** 자리별 시간 상한 — ELDA_HOOK_TIMEOUT_MS_<자리>(예 ELDA_HOOK_TIMEOUT_MS_UserPromptSubmit=5000). 손님 턴은 60초를 기다릴 수 없다 */
const timeoutFor = (name: string) => Number(process.env[`ELDA_HOOK_TIMEOUT_MS_${name}`] ?? TIMEOUT_MS)

type HookDef = { type: "http"; url: string; timeout?: number } | { type: "command"; command: string; timeout?: number }
type Group = { matcher?: string; hooks: HookDef[] }
const EVENTS = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop"] as const
const RANK: Record<string, number> = { deny: 3, ask: 2, allow: 1, defer: 0 }

export async function loadHooks(): Promise<Hooks> {
  const p = process.env.ELDA_HOOKS
  if (!p) return {}
  if (!p.endsWith(".json")) return (await import(pathToFileURL(p).href)) as Hooks
  const raw = JSON.parse(readFileSync(p, "utf8"))
  const table = (raw.hooks ?? raw) as Record<string, Group[]>
  const out: Hooks = {}
  for (const [ev, groups] of Object.entries(table)) {
    if (!(EVENTS as readonly string[]).includes(ev) || !Array.isArray(groups)) throw new Error(`ELDA_HOOKS: 모르는 자리 ${ev}`)   // H12 — 모르는 설정은 거절
    for (const g of groups) for (const h of g.hooks ?? []) {
      if (!(h.type === "http" && typeof (h as { url?: unknown }).url === "string") && !(h.type === "command" && typeof (h as { command?: unknown }).command === "string"))
        throw new Error(`ELDA_HOOKS: ${ev} 의 훅은 {type:http,url} 또는 {type:command,command}`)
    }
    ;(out as Record<string, unknown>)[ev] = async (input: Record<string, unknown>) => {
      const tool = typeof input.tool_name === "string" ? input.tool_name : undefined
      const outs: Out[] = []
      for (const g of groups) {
        if (tool && g.matcher && !new RegExp(`^(?:${g.matcher})$`).test(tool)) continue
        for (const h of g.hooks) outs.push(await callOne(h, input))   // 하나가 실패하면 throw → run() 이 자리 규칙대로(UserPromptSubmit = 막음)
      }
      return merge(outs)
    }
  }
  return out
}

async function callOne(h: HookDef, input: unknown): Promise<Out> {
  const ms = h.timeout ? h.timeout * 1000 : undefined
  const body = JSON.stringify(input)
  if (h.type === "http") {
    const r = await fetch(h.url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ms ? AbortSignal.timeout(ms) : undefined })
    if (!r.ok) throw new Error(`hook_http_${r.status}`)
    const t = await r.text()
    return t.trim() ? (JSON.parse(t) as Out) : {}
  }
  return await new Promise<Out>((res, rej) => {
    const c = spawn("sh", ["-c", h.command], { stdio: ["pipe", "pipe", "pipe"] })
    let so = "", se = ""
    const t = ms ? setTimeout(() => { c.kill(); rej(new Error("hook_timeout")) }, ms) : null
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d))
    c.on("close", (code) => {
      if (t) clearTimeout(t)
      if (code === 0) { try { res(so.trim() ? (JSON.parse(so) as Out) : {}) } catch { rej(new Error("hook_bad_json")) } }
      else if (code === 2) res({ decision: "block", reason: se.trim() || undefined })
      else rej(new Error(`hook_exit_${code}`))
    })
    c.stdin.end(body)
  })
}

/** 여러 훅의 출력을 하나로 — block 이 이기고 · deny > ask > allow · 맥락·이유는 이어 붙이고 · 바꾼 값은 뒤가 이긴다(Elda CLI 와 같다) */
function merge(outs: Out[]): Out {
  const res: Out = {}
  const ctx: string[] = [], reasons: string[] = []
  let hso: NonNullable<Out["hookSpecificOutput"]> | undefined
  for (const o of outs) {
    if (o.decision === "block") { res.decision = "block"; if (o.reason) reasons.push(o.reason) }
    if (o.stopReason) res.stopReason = o.stopReason
    const h = o.hookSpecificOutput
    if (!h) continue
    hso = { ...(hso ?? { hookEventName: h.hookEventName }), ...h }
    if (h.additionalContext) ctx.push(h.additionalContext)
    const prev = outs.map((x) => x.hookSpecificOutput?.permissionDecision).filter(Boolean) as string[]
    if (prev.length) hso.permissionDecision = prev.sort((a, b) => RANK[b]! - RANK[a]!)[0] as never
  }
  if (reasons.length) res.reason = reasons.join("\n")
  if (hso) { if (ctx.length) hso.additionalContext = ctx.join("\n\n"); res.hookSpecificOutput = hso }
  return res
}

/**
 * 훅 하나 부르기 — 시간 상한을 걸고, 실패하면 자리마다 정해진 쪽으로 간다(H36 · 절 J — Claude Code 와 같다):
 *   UserPromptSubmit 실패·시간 초과 = **그 입력을 막는다**(fail-closed). 위험 바닥·페르소나가 이 자리라 건너뛰고 두뇌로 가면 안 된다.
 *     ELDA_HOOK_FAIL_REPLY 가 있으면 그 문장을 손님 답으로(block + reason), 없으면 error{hook_failed}.
 *   그 밖 자리 = 결정 없음(continue). 도구 앞뒤·Stop 의 실패가 턴을 죽이지 않는다.
 */
export async function run<K extends keyof Hooks>(hooks: Hooks, name: K, input: Parameters<NonNullable<Hooks[K]>>[0]): Promise<Out> {
  const f = hooks[name] as ((i: unknown) => Promise<Out | void>) | undefined
  if (!f) return {}
  try {
    const r = await Promise.race([f(input), new Promise<void>((_, rej) => setTimeout(() => rej(new Error("hook_timeout")), timeoutFor(String(name))).unref())])
    return r ?? {}
  } catch (e) {
    process.stderr.write(`hook ${String(name)} 실패: ${(e as Error).message}\n`)
    if (name === "UserPromptSubmit") return { decision: "block", reason: process.env.ELDA_HOOK_FAIL_REPLY, stopReason: "hook_failed" }
    return {}
  }
}
