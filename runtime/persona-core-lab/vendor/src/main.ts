#!/usr/bin/env node
// 표준 하네스 실행기 틀(③ 서빙 프로필) — 하네스 규격 절 A~D 를 지키는 가장 작은 실행기. 의존성 없음, node 24.
// 새 실행기(EldaCore 판 등)는 이것을 복사해 시작한다: 루프·줄 형식은 그대로 두고, 두뇌는 brains.ts, 값은 hooks.ts 에 더한다.
//
//   환경: ELDA_MODEL(두뇌 칸) · ELDA_MCP(JSON 배열 — MCP 서버 명령, {workspace} 를 편다) · ELDA_WORKSPACE
//         ELDA_SYSTEM(시스템 지시 파일) · ELDA_MAX_TURNS(한 턴 안 왕복 상한, 기본 12) · ELDA_HISTORY=1(turn_end 에 기록)
//         ELDA_HOOKS(훅 모듈) · ELDA_BRAIN_ALLOW(훅이 턴마다 고를 수 있는 두뇌 칸, 쉼표) · ELDA_GATEWAY_URL·ELDA_GATEWAY_KEY_FILE(eldacore:) · ELDA_API_KEY_FILE(openai-compat:)
//   stdin  한 줄 = op 하나: prompt{text} · interrupt · new · (③ 은 approve·notify 를 받지 않는다 — H16)
//   stdout 한 줄 = 이벤트 하나(H1·H3)
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { ApiError, makeBrain, type Block, type Brain, type Msg, type Usage4 } from "./brains.ts"
import { DeltaBuffer, emit, log } from "./events.ts"
import { loadHooks, run, type Hooks } from "./hooks.ts"
import { McpClient } from "./mcp.ts"

const RETRYABLE = new Set([429, 500, 502, 503, 529])
const BRAIN_ALLOW = new Set((process.env.ELDA_BRAIN_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean))
const brains = new Map<string, Brain>()                                  // H11 — 두뇌 연결은 대화 동안 다시 쓴다
const brainFor = (name: string): Brain => { let b = brains.get(name); if (!b) { b = makeBrain(name); brains.set(name, b) } return b }

class Session {
  id = randomUUID()
  messages: Msg[] = []
  busy = false
  queue: string[] = []
  abort: AbortController | null = null
  brain: Brain; mcp: McpClient | null; hooks: Hooks; system: string; maxTurns: number; cwd: string
  constructor(brain: Brain, mcp: McpClient | null, hooks: Hooks, system: string, maxTurns: number, cwd: string) {
    this.brain = brain; this.mcp = mcp; this.hooks = hooks; this.system = system; this.maxTurns = maxTurns; this.cwd = cwd
  }

  newConversation() { this.id = randomUUID(); this.messages = [] }

  async turn(text: string): Promise<void> {
    this.busy = true
    const t0 = Date.now()
    const mark = this.messages.length            // 오류·중단이면 이 턴을 기록에서 뺀다(H33)
    const usage: Usage4 = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    let turns = 0, toolCalls = 0, toolFailed = false, servedBy: string | undefined, retried = false
    let brainMs = 0, toolMs = 0
    const base = () => ({ session_id: this.id, cwd: this.cwd })
    const ctl = (this.abort = new AbortController())
    let brain: Brain = this.brain                                         // 이 턴의 두뇌 — UserPromptSubmit 이 허용 목록 안에서 바꿀 수 있다(v0.815)
    emit("turn_start", { text })

    const end = (ok: boolean, endReason: string, extra: Record<string, unknown> = {}) => {
      emit("turn_end", {
        ok, endReason, turns, toolCalls, usage, durationMs: Date.now() - t0, model: brain.name, sessionId: this.id,
        costBasis: brain.costBasis, runCompleted: endReason === "completed", policyRejected: false, toolFailed,
        diag: { brainMs, toolMs, retried }, ...(servedBy ? { servedBy } : {}),
        ...(process.env.ELDA_HISTORY === "1" ? { history: this.messages } : { messages: undefined, messageCount: this.messages.length }), ...extra,
      })
    }
    try {
      // UserPromptSubmit — 맥락 주입(페르소나·기억)
      const ups = await run(this.hooks, "UserPromptSubmit", { ...base(), hook_event_name: "UserPromptSubmit", prompt: text })
      // block + reason = 두뇌 없이 답한다(Claude Code 계약: 막은 이유는 사용자에게 보인다 · 프롬프트는 기록에 남기지 않는다).
      // 정해진 거절 문장·결정론 답(NPC)이 이 길이다 — 두뇌 호출 0(v0.815)
      if (ups.decision === "block") {
        if (ups.reason) {                                                  // 훅 실패의 손님용 문장도 이 길 — 그때는 실패로 센다(ok:false)
          const failed = ups.stopReason === "hook_failed"
          emit("text", { text: ups.reason }); end(!failed, failed ? "error" : "completed", { answeredBy: "hook", ...(failed ? { hookFailed: true } : {}) })
        }
        else { emit("error", { code: ups.stopReason === "hook_failed" ? "hook_failed" : "blocked", message: "" }); end(false, "error") }
        return
      }
      const want = ups.hookSpecificOutput?.brain
      if (want && want !== brain.name) {
        if (BRAIN_ALLOW.has(want)) brain = brainFor(want)                // H13 — 손님이 아니라 훅(입구가 믿는 코드)이 고르고, 입구가 정한 목록 밖은 듣지 않는다
        else emit("notice", { text: `허용 목록 밖 두뇌 칸이라 무시: ${want.slice(0, 60)}` })
      }
      const ctx = ups.hookSpecificOutput?.additionalContext
      this.messages.push({ role: "user", content: [{ type: "text", text: ctx ? `${ctx}\n\n${text}` : text }] })
      let stopActive = false

      for (;;) {
        if (turns >= this.maxTurns) {                                      // H34 — 왕복 상한
          emit("error", { code: "max_turns", message: `왕복 상한 ${this.maxTurns}` })
          end(false, "max_turns")
          return
        }
        turns += 1
        const tb = Date.now()
        let reply
        try { reply = await brain.complete(this.system, this.messages, this.mcp?.tools ?? [], ctl.signal) }
        catch (e) {
          if (e instanceof ApiError && RETRYABLE.has(e.status) && toolCalls === 0 && !retried) {   // H20 — 도구 전 일시 오류만 한 번
            retried = true; turns -= 1
            emit("retry", { status: e.status, retryAfter: e.retryAfter ?? null })
            await new Promise((r) => setTimeout(r, Math.min(Number(e.retryAfter ?? 2), 60) * 1000))
            continue
          }
          throw e
        } finally { brainMs += Date.now() - tb }
        for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) usage[k] += reply.usage[k]
        servedBy = reply.servedBy ?? servedBy
        this.messages.push({ role: "assistant", content: reply.content })
        const delta = new DeltaBuffer()
        for (const b of reply.content) if (b.type === "text" && b.text) { delta.push(b.text); delta.flush(); emit("text", { text: b.text }) }

        const uses = reply.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use")
        if (!uses.length) {
          if (reply.finish === "length") { emit("error", { code: "output_limit", message: "두뇌 출력 상한" }); end(false, "output_limit"); return }
          if (reply.finish === "refusal") { emit("error", { code: "refusal", message: "두뇌가 거절했다" }); this.messages.length = mark; end(false, "error"); return }
          // Stop — 일관성 판정. 막으면 이유를 사람 말 자리에 넣어 이어서 고치게 한다(한 번만)
          const last = reply.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("")
          const st = await run(this.hooks, "Stop", { ...base(), hook_event_name: "Stop", stop_hook_active: stopActive, last_assistant_message: last })
          if (st.decision === "block" && !stopActive && st.reason) {
            stopActive = true
            this.messages.push({ role: "user", content: [{ type: "text", text: `<stop-hook>${st.reason}</stop-hook>` }] })
            continue
          }
          end(true, "completed")
          return
        }
        const results: Block[] = []
        for (const u of uses) {
          toolCalls += 1
          const pre = await run(this.hooks, "PreToolUse", { ...base(), hook_event_name: "PreToolUse", tool_name: u.name, tool_input: u.input, tool_use_id: u.id })
          const input = pre.hookSpecificOutput?.updatedInput ?? u.input
          emit("tool_call", { tool: u.name, callId: u.id, input })
          let r: { ok: boolean; output: string }
          const ts = Date.now()
          if (pre.hookSpecificOutput?.permissionDecision === "deny") r = { ok: false, output: `denied: ${pre.hookSpecificOutput.permissionDecisionReason ?? ""}` }
          else if ("_invalid_json" in input) r = { ok: false, output: "invalid_json: 도구 인자가 JSON 이 아니다 — 고쳐서 다시 부른다" }   // H41
          else if (!this.mcp) r = { ok: false, output: `unknown_tool: ${u.name}` }
          else r = await this.mcp.call(u.name, input)
          const dur = Date.now() - ts
          toolMs += dur
          const post = r.ok
            ? await run(this.hooks, "PostToolUse", { ...base(), hook_event_name: "PostToolUse", tool_name: u.name, tool_input: input, tool_use_id: u.id, tool_response: r.output, duration_ms: dur })
            : await run(this.hooks, "PostToolUseFailure", { ...base(), hook_event_name: "PostToolUseFailure", tool_name: u.name, tool_input: input, tool_use_id: u.id, error: r.output, duration_ms: dur })
          let out = post.hookSpecificOutput?.updatedToolOutput ?? r.output
          if (post.hookSpecificOutput?.additionalContext) out += `\n\n${post.hookSpecificOutput.additionalContext}`
          if (!r.ok) toolFailed = true
          emit("tool_result", { tool: u.name, callId: u.id, ok: r.ok, output: out.slice(0, 4000) })
          results.push({ type: "tool_result", tool_use_id: u.id, content: out, is_error: !r.ok })
        }
        this.messages.push({ role: "user", content: results })
      }
    } catch (e) {
      this.messages.length = mark                                         // 오류 턴은 기록에서 뺀다 → 같은 말로 깨끗하게 다시(H20)
      if (ctl.signal.aborted) { emit("error", { code: "interrupted", message: "중단" }); return }   // 중단 = error+idle 짝, turn_end 없음(H33)
      if (e instanceof ApiError) { emit("error", { code: "api_error", message: `${e.status} ${e.code}` }); end(false, "error", { apiErrorStatus: e.status }); return }
      emit("error", { code: "brain_error", message: String((e as Error).message).slice(0, 200) })
      end(false, "error")
    } finally {
      this.abort = null
      this.busy = false
      emit("idle", {})                                                    // H6 — 턴마다(실패해도)
      const next = this.queue.shift()
      if (next !== undefined) void this.turn(next)
    }
  }
}

async function main(): Promise<number> {
  const spec = process.env.ELDA_MODEL
  if (!spec) { emit("error", { code: "config", message: "ELDA_MODEL 이 없다" }); return 2 }
  const ws = process.env.ELDA_WORKSPACE ?? process.cwd()
  let brain: Brain
  try { brain = makeBrain(spec) } catch (e) { emit("error", { code: "config", message: (e as Error).message }); return 2 }
  let mcp: McpClient | null = null
  if (process.env.ELDA_MCP) {
    const cmd = (JSON.parse(process.env.ELDA_MCP) as string[]).map((a) => a.replace("{workspace}", ws))
    mcp = new McpClient(cmd, process.env)
    await mcp.start()
  }
  const system = process.env.ELDA_SYSTEM ? readFileSync(process.env.ELDA_SYSTEM, "utf8") : ""
  const s = new Session(brain, mcp, await loadHooks(), system, Number(process.env.ELDA_MAX_TURNS ?? 12), ws)
  emit("ready", { model: brain.name, sessionId: s.id, tools: mcp?.tools.map((t) => t.name) ?? [] })

  const rl = createInterface({ input: process.stdin })
  rl.on("line", (line) => {
    if (!line.trim()) return
    let op: any
    try { op = JSON.parse(line) } catch { emit("error", { code: "bad_input", message: "JSON 줄이 아니다" }); return }
    switch (op?.op) {
      case "prompt":
        if (typeof op.text !== "string") { emit("error", { code: "bad_input", message: "prompt.text" }); return }
        if (s.busy) { s.queue.push(op.text); emit("queued", { text: op.text }); return }
        void s.turn(op.text)
        return
      case "interrupt": s.abort?.abort(); return
      case "new":
        if (s.busy) { emit("error", { code: "busy", message: "턴이 끝난 뒤 new" }); return }
        s.newConversation(); emit("notice", { text: "새 대화", sessionId: s.id }); return
      default:
        emit("error", { code: "bad_input", message: `모르는 op: ${String(op?.op).slice(0, 40)}` })
    }
  })
  await new Promise<void>((res) => rl.on("close", res))                  // EOF → 하던 턴을 마치고 정리(H2)
  while (s.busy) await new Promise((r) => setTimeout(r, 50))
  mcp?.close()
  return 0
}

main().then((c) => { process.exitCode = c }, (e) => { log(e); process.exitCode = 1 })
