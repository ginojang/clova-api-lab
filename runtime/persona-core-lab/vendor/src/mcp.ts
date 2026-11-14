// 도구(절 C) — MCP 로만 붙인다(H14). 서버는 대화 내내 하나(H15). stdio 줄 JSON-RPC, 의존성 없음.
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import type { Tool } from "./brains.ts"

export class McpClient {
  private proc: ChildProcess
  private id = 0
  private pending = new Map<number, (r: any) => void>()
  tools: Tool[] = []
  constructor(cmd: string[], env: NodeJS.ProcessEnv) {
    this.proc = spawn(cmd[0]!, cmd.slice(1), { env, stdio: ["pipe", "pipe", "inherit"] })   // 래퍼의 stderr 는 실행기 stderr 로 — stdout 을 더럽히지 않는다(H1)
    createInterface({ input: this.proc.stdout! }).on("line", (l) => {
      let m: any
      try { m = JSON.parse(l) } catch { return }
      const res = this.pending.get(m.id)
      if (res) { this.pending.delete(m.id); res(m) }
    })
    this.proc.on("exit", () => { for (const r of this.pending.values()) r({ error: { message: "MCP 서버가 끝났다" } }); this.pending.clear() })
  }
  private rpc(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.id
    return new Promise((res) => {
      this.pending.set(id, res)
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }
  async start(): Promise<void> {
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "elda-harness-template", version: "0.1" } })
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
    const r = await this.rpc("tools/list")
    this.tools = (r.result?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  }
  /** H37 — 붙인 도구만. 목록 밖 이름은 부르지 않고 "없는 도구" 로 돌려준다 */
  async call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    if (!this.tools.some((t) => t.name === name)) return { ok: false, output: `unknown_tool: ${name} 은 붙인 도구가 아니다` }
    const r = await this.rpc("tools/call", { name, arguments: args })
    if (r.error) return { ok: false, output: `mcp_error: ${r.error.message ?? ""}` }
    const text = (r.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
    return { ok: !r.result?.isError, output: text }
  }
  close() { this.proc.stdin!.end(); setTimeout(() => this.proc.kill(), 2000).unref() }
}
