// EldaCore 훅 모듈 — 판단은 오케 한 자리(HOOK_CONTRACT v0.1) · 이 파일은 얇은 HTTP 둘뿐이다.
//   UserPromptSubmit → 오케 POST /api/v1_0/turn/before  (맥락 + 그 턴 두뇌 / block+reason 답 / block)
//   Stop             → 오케 POST /api/v1_0/turn/after   (두뇌 답을 넣는다 → 오케가 판정·기록·기억을 마친다)
//   ⛔ 실패는 던진다 — 턴 앞 실패는 실행기가 입력을 막는다(fail-closed · v0.816) · Stop 실패는 실행기가 결정 없음으로 넘긴다
//   ELDA_ORCH_URL(기본 http://127.0.0.1:3200)
import type { HookBase, Out } from "./src/hooks.ts"

const ORCH = (process.env.ELDA_ORCH_URL ?? "http://127.0.0.1:3200").replace(/\/$/, "")
/** 오케 대화 id 접두 — 시험·키트는 `cv-orch01-verify-` 로(오케가 검증 턴으로 갈라 실턴 원장·골드를 안 더럽힌다) */
const SID_PREFIX = process.env.ELDA_SESSION_PREFIX ?? ""
const sid = <T extends { session_id: string }>(i: T): T => ({ ...i, session_id: SID_PREFIX + i.session_id })

async function post(path: string, body: unknown, ms: number): Promise<Out> {
  const r = await fetch(`${ORCH}${path}`, { method: "POST", headers: { "content-type": "application/json" },
                                           body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return (await r.json()) as Out
}

export async function UserPromptSubmit(i: HookBase & { prompt: string; notifications?: unknown[] }): Promise<Out> {
  return post("/api/v1_0/turn/before", sid(i), Number(process.env.ELDA_HOOK_TIMEOUT_MS_UserPromptSubmit ?? 8000))
}

export async function Stop(i: HookBase & { stop_hook_active: boolean; last_assistant_message: string }): Promise<Out> {
  return post("/api/v1_0/turn/after", sid(i), Number(process.env.ELDA_HOOK_TIMEOUT_MS_Stop ?? 5000))
}
