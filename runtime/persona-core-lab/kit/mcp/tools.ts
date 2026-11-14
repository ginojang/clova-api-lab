// 틀의 도구 — 안정 API(W6). 새 래퍼는 이 파일을 앱에 맞게 다시 쓴다. 지킬 것은 SPEC.md 의 각 규칙 번호로 달아 두었다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { MemoApp, type Note } from "./app.ts"
import { batchTool, ids, insideWorkspace, num, str } from "./kit.ts"
import { WrapperError, type Tool } from "./server.ts"

export const API_VERSION = "1.0.0"

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required })
const MM = (what: string) => ({ type: "number", description: `${what} mm` }) // 숫자 인자에는 단위(W9)

/** 크기 측정(W23)과 대지 밖 경고(W22) */
function judge(app: MemoApp, notes: Note[]) {
  const d = app.doc!
  const measure: string[] = []
  const warnings: string[] = []
  for (const n of notes.slice(0, 5)) {
    const out = [n.x < 0 && `왼쪽 ${-n.x}mm`, n.y < 0 && `위 ${-n.y}mm`, n.x + n.width > d.width && `오른쪽 ${n.x + n.width - d.width}mm`, n.y + n.height > d.height && `아래 ${n.y + n.height - d.height}mm`].filter(Boolean)
    if (out.length) warnings.push(`메모 ${n.id} 이(가) 대지 밖으로 나간다: ${out.join(" · ")} — 자리를 고친다`)
    else measure.push(`메모 ${n.id}: 대지 폭 ${Math.round((n.width / d.width) * 100)}% · 여백 왼 ${n.x} 위 ${n.y}mm`)
  }
  return { ...(measure.length ? { measure } : {}), ...(warnings.length ? { warnings } : {}) }
}

export function makeTools(app: MemoApp, workspace: string): Tool[] {
  const tools: Tool[] = [
    {
      name: "api_version",
      description: "이 래퍼의 안정 API 버전을 돌려준다(W7).",
      inputSchema: obj({}),
      run: async () => ({ version: API_VERSION, workspace }),
    },
    {
      name: "document_create",
      description: "새 메모판을 만든다. 크기는 mm.",
      inputSchema: obj({ width: MM("폭"), height: MM("높이") }, ["width", "height"]),
      run: async (a) => {
        const w = num(a, "width", { min: 1 })!, h = num(a, "height", { min: 1 })!
        app.create(w, h)
        return { width: w, height: h }
      },
    },
    {
      name: "document_info",
      description: "지금 메모판의 크기와 메모 목록을 돌려준다.",
      inputSchema: obj({}),
      run: async () => {
        if (!app.doc) throw new WrapperError("not_found", "열린 문서가 없다 — document_create 먼저")
        return app.doc
      },
    },
    {
      name: "document_open",
      description: "작업 폴더의 메모판 문서(JSON)를 연다.",
      inputSchema: obj({ path: { type: "string", description: "작업 폴더 기준 경로" } }, ["path"]),
      run: async (a) => {
        const p = insideWorkspace(workspace, a.path)
        let text: string
        try {
          text = readFileSync(p, "utf8")
        } catch {
          throw new WrapperError("not_found", `파일이 없다: ${a.path}`)
        }
        app.load(text)
        return { notes: app.doc!.notes.length }
      },
    },
    {
      name: "note_add",
      description: "메모 하나를 붙인다. 좌표는 대지 왼쪽 위 기준 mm, 아래로 y 증가.",
      inputSchema: obj({ text: { type: "string", description: "메모 글" }, x: MM("왼쪽에서"), y: MM("위에서") }, ["text", "x", "y"]),
      run: async (a) => {
        const text = str(a, "text")!, x = num(a, "x")!, y = num(a, "y")!
        const n = app.add(text, x, y)
        return { id: n.id, ...judge(app, [n]) } // 만든 것의 id(W20)
      },
    },
    {
      name: "note_move",
      description: "메모를 옮긴다(상대 이동, mm).",
      inputSchema: obj({ ids: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "number" }], description: "메모 id 목록 — 하나면 숫자만" }, dx: MM("가로 이동"), dy: MM("세로 이동") }, ["ids", "dx", "dy"]),
      run: async (a) => {
        const list = ids(a), dx = num(a, "dx")!, dy = num(a, "dy")!
        app.move(list, dx, dy)
        return { ids: list, ...judge(app, app.find(list)) }
      },
    },
    {
      name: "note_delete",
      description: "메모를 지운다.",
      inputSchema: obj({ ids: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "number" }], description: "메모 id 목록 — 하나면 숫자만" } }, ["ids"]),
      run: async (a) => {
        const list = ids(a)
        app.remove(list)
        return { ids: list }
      },
    },
    {
      name: "export",
      description: "메모판을 파일로 내보낸다 — json(문서 원본) · txt(읽기용).",
      inputSchema: obj({ format: { type: "string", enum: ["json", "txt"] }, path: { type: "string", description: "작업 폴더 기준 경로" } }, ["format", "path"]),
      run: async (a) => {
        const format = str(a, "format")!
        if (format !== "json" && format !== "txt") throw new WrapperError("invalid_argument", `format 은 json · txt(받은 값 ${format})`)
        const p = insideWorkspace(workspace, a.path)
        const body = format === "json" ? JSON.stringify(app.doc ?? (() => { throw new WrapperError("not_found", "열린 문서가 없다") })()) : app.toText()
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, body)
        return { path: a.path, bytes: Buffer.byteLength(body) }
      },
    },
  ]
  tools.push(batchTool(() => tools))
  // W34 — 도구 성질. 작업 폴더 안에서만 일하므로 openWorldHint 는 모두 false.
  const READ_ONLY = new Set(["api_version", "document_info"])
  const DESTRUCTIVE = new Set(["document_create", "document_open", "note_delete", "export", "batch"])
  const IDEMPOTENT = new Set([...READ_ONLY, "export"])
  return tools.map((t) => ({
    ...t,
    annotations: { readOnlyHint: READ_ONLY.has(t.name), destructiveHint: DESTRUCTIVE.has(t.name), idempotentHint: IDEMPOTENT.has(t.name), openWorldHint: false },
  }))
}
