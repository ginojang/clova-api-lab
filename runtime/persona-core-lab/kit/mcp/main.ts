#!/usr/bin/env node
// memo-mcp — Wrapper MCP 틀(규격 v1.0 적합 예시). 새 래퍼는 memo/MEMO 를 앱 이름으로 바꾼다.
//   memo-mcp mcp --workspace DIR [--lean]                     MCP 서버(W2)
//   memo-mcp convert --in DOC.json --format txt --out FILE    두뇌 없이 형식 바꾸기(W26)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { MemoApp } from "./app.ts"
import { leanTools } from "./kit.ts"
import { serve } from "./server.ts"
import { API_VERSION, makeTools } from "./tools.ts"

const APP = "memo"
const ENV = APP.toUpperCase()
const INSTRUCTIONS = `메모판을 안정 API 로 다룬다. 길이는 모두 mm, 좌표는 대지 왼쪽 위 기준이고 아래로 y 가 커진다.
파일은 작업 폴더 안에서만 읽고 쓴다. 도구 한 번 = 되돌리기 한 번이고, 실패한 도구는 문서를 바꾸지 않는다.
★ 여러 작업은 batch 한 번에 묶어라. 오류는 "code: 내용" — invalid_argument(고쳐서 다시) · not_found · denied(작업 폴더 밖).`

const opt = (argv: string[], k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "convert") {
    const input = opt(argv, "--in"), format = opt(argv, "--format"), out = opt(argv, "--out")
    if (!input || format !== "txt" || !out) return (console.error("사용: memo-mcp convert --in DOC.json --format txt --out FILE"), 2)
    const app = new MemoApp()
    app.load(readFileSync(input, "utf8"))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, app.toText())
    return 0
  }
  const workspace = opt(argv, "--workspace")
  if (argv[0] !== "mcp" || !workspace || !existsSync(workspace)) {
    console.error("사용: memo-mcp mcp --workspace DIR [--lean]   |   memo-mcp convert --in DOC.json --format txt --out FILE")
    return 2
  }
  const app = new MemoApp()
  const all = makeTools(app, workspace)
  const autosave = process.env[`${ENV}_MCP_AUTOSAVE`] // W25 — 작업 폴더 기준 경로
  await serve(argv.includes("--lean") ? leanTools(all) : all, {
    name: `${APP}-mcp`,
    version: API_VERSION,
    instructions: INSTRUCTIONS,
    noteEnv: `${ENV}_MCP_NOTE`,
    afterCall: autosave
      ? async () => {
          if (!app.doc) return
          const p = join(workspace, autosave)
          mkdirSync(dirname(p), { recursive: true })
          writeFileSync(p, JSON.stringify(app.doc))
        }
      : undefined,
  })
  return 0
}

process.exitCode = await main(process.argv.slice(2))
