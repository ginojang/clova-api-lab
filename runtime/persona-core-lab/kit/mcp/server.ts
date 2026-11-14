// Wrapper MCP 틀 — MCP 입구(stdio 줄 JSON-RPC). 규격 W3·W4·W13·W14·W15.
// 이 파일은 앱과 상관없다 — 새 래퍼는 그대로 쓰고 tools.ts·app.ts 만 바꾼다.
import { createInterface } from "node:readline"

export class WrapperError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** W34 — readOnlyHint · destructiveHint · idempotentHint · openWorldHint */
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  run: (args: Record<string, unknown>) => Promise<unknown>
}

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]

export interface ServeOptions {
  name: string // "<앱>-mcp" (W1)
  version: string // API 버전 semver (W7)
  instructions: string // 시작 안내 — 단위·좌표계·오류 code 목록(W10·W15), 1,200자 이하(W13)
  noteEnv?: string // "<APP>_MCP_NOTE" (W14)
  afterCall?: () => Promise<void> // 도구 하나가 끝날 때마다(자동 저장 W25 등)
  log?: (line: string) => void // stderr 로만 (W3)
}

/** stdout 에는 프로토콜만 쓴다(W3). 요청은 순서대로 처리한다(되돌리기 묶음이 섞이지 않게). */
export function serve(tools: Tool[], opts: ServeOptions): Promise<void> {
  const log = opts.log ?? ((line: string) => process.stderr.write(`${opts.name}: ${line}\n`))
  const byName = new Map(tools.map((t) => [t.name, t]))
  const send = (m: object) => void process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`)
  const note = opts.noteEnv ? process.env[opts.noteEnv]?.trim() : undefined
  let queue = Promise.resolve()

  async function handle(req: { jsonrpc?: string; id?: number | string | null; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } }) {
    const { id, method, params } = req
    if (id === undefined || id === null) return // 알림
    const reply = (result: object) => send({ id, result })
    const fail = (code: number, message: string) => send({ id, error: { code, message } })
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion ?? "") ? params!.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: opts.name, version: opts.version },
          instructions: note ? `${opts.instructions}\n${note}` : opts.instructions,
        })
      case "ping":
        return reply({})
      case "tools/list":
        return reply({ tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) })
      case "tools/call": {
        const tool = byName.get(params?.name ?? "")
        if (!tool) return fail(-32602, `없는 도구: ${params?.name}`)
        try {
          const result = await tool.run(params?.arguments ?? {})
          reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: false })
          await opts.afterCall?.().catch((e) => log(`afterCall 실패: ${e}`))
        } catch (e) {
          const text = e instanceof WrapperError ? `${e.code}: ${e.message}` : `engine: ${e instanceof Error ? e.message : e}`
          log(`${tool.name} 실패: ${text}`)
          reply({ content: [{ type: "text", text }], isError: true })
        }
        return
      }
      default:
        return fail(-32601, `없는 메서드: ${method}`)
    }
  }

  return new Promise((resolve) => {
    const lines = createInterface({ input: process.stdin })
    lines.on("line", (line) => {
      if (!line.trim()) return
      let req
      try {
        req = JSON.parse(line)
      } catch {
        return send({ id: null, error: { code: -32700, message: "JSON 이 아니다" } })
      }
      queue = queue.then(() => handle(req)).catch((e) => log(`처리 실패: ${e}`))
    })
    lines.on("close", () => void queue.then(resolve)) // 입력이 닫히면 끝난다(W27)
  })
}
