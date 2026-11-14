// Wrapper MCP 틀 — 앱과 상관없는 공용 조각: 작업장 경로(W24) · batch(W11) · 인자 읽기(W15·W16·W18·W19) · 가벼운 모드(W12).
import { realpathSync, existsSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { WrapperError, type Tool } from "./server.ts"

/** 작업장 안 경로만 돌려준다 — `../`·절대 경로·심볼릭 링크로 나가기는 denied (W24). */
export function insideWorkspace(root: string, path: unknown): string {
  if (typeof path !== "string" || !path.trim()) throw new WrapperError("invalid_argument", "path 는 작업 폴더 기준 경로 글자여야 한다")
  if (isAbsolute(path)) throw new WrapperError("denied", `절대 경로는 안 된다: ${path} — 작업 폴더 기준 경로로`)
  const base = realpathSync(root)
  const full = resolve(base, path)
  // 있는 부분까지 실제 경로로 풀어 심볼릭 링크로 나가는 것도 막는다
  let probe = full
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const real = resolve(realpathSync(probe), relative(probe, full))
  const rel = relative(base, real)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new WrapperError("denied", `작업 폴더 밖이다: ${path}`)
  return real
}

/** 숫자 인자 — 없거나 숫자가 아니면 invalid_argument(받은 값 포함, W16). */
export function num(args: Record<string, unknown>, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number | undefined {
  const v = args[key]
  if (v === undefined && opts.optional) return undefined
  if (typeof v !== "number" || !Number.isFinite(v)) throw new WrapperError("invalid_argument", `${key} 는 숫자여야 한다(받은 값 ${JSON.stringify(v)})`)
  if (opts.min !== undefined && v < opts.min) throw new WrapperError("invalid_argument", `${key} 는 ${opts.min} 이상(받은 값 ${v})`)
  if (opts.max !== undefined && v > opts.max) throw new WrapperError("invalid_argument", `${key} 는 ${opts.max} 이하(받은 값 ${v})`)
  return v
}

export function str(args: Record<string, unknown>, key: string, opts: { optional?: boolean } = {}): string | undefined {
  const v = args[key]
  if (v === undefined && opts.optional) return undefined
  if (typeof v !== "string" || !v) throw new WrapperError("invalid_argument", `${key} 는 글자여야 한다(받은 값 ${JSON.stringify(v)})`)
  return v
}

/** id 목록 — 숫자 하나도 받는다(W19). */
export function ids(args: Record<string, unknown>, key = "ids"): number[] {
  const v = args[key]
  const list = Array.isArray(v) ? v : typeof v === "number" ? [v] : undefined
  if (!list || !list.length || !list.every((x) => typeof x === "number")) throw new WrapperError("invalid_argument", `${key} 는 id 숫자 목록(하나면 숫자만)이다(받은 값 ${JSON.stringify(v)})`)
  return list as number[]
}

/**
 * batch 도구(W11) — 단계에 as 로 이름을 붙이고 뒤에서 "$이름.id"·"$N.id" 로 가리킨다. 이름은 대화 내내 남는다.
 * 실패하면 그 단계에서 멈추고 이미 한 단계는 남긴다 — 성공으로 돌려주고 failed 칸에 이유.
 */
export function batchTool(getTools: () => Tool[], maxSteps = 40): Tool {
  const names = new Map<string, unknown>()
  const pick = (v: unknown, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v)
  const resolveRefs = (v: unknown, results: unknown[], index: number): unknown => {
    if (typeof v === "string" && v.startsWith("$")) {
      const [head, ...rest] = v.slice(1).split(".")
      const n = Number(head)
      const base = Number.isInteger(n) ? results[n] : names.get(head!)
      if (base === undefined)
        throw new WrapperError("invalid_argument", Number.isInteger(n) ? `${v}: 단계 ${n} 은 아직 없다(지금 ${index}단계, 0부터)` : `${v}: 이름 ${head} 이(가) 없다 — 있는 이름: ${[...names.keys()].join(", ") || "없음"}`)
      const got = pick(base, rest)
      if (got === undefined) throw new WrapperError("invalid_argument", `${v}: 그 결과에 ${rest.join(".")} 가 없다`)
      return got
    }
    if (Array.isArray(v)) return v.flatMap((x) => {
      const r = resolveRefs(x, results, index)
      return Array.isArray(r) && typeof x === "string" && x.endsWith(".ids") ? r : [r]
    })
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, results, index)]))
    return v
  }
  return {
    name: "batch",
    description: "★ 여러 도구를 한 번에 — 호출이 줄수록 빠르고 싸다. steps 를 순서대로 실행하고 결과를 차례로 돌려준다. 단계에 as:\"이름\" 을 붙이고 뒤에서 \"$이름.id\"(번호 \"$N.id\", 0부터). 실패하면 그 단계에서 멈추고(이미 한 단계는 남는다) failed 에 어디서 왜 멈췄는지.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" }, as: { type: "string", description: "이 단계 이름 — 뒤에서 \"$이름.id\"" } }, required: ["tool"] },
          description: "다른 도구 이름과 인자(batch 안에 batch 는 안 된다)",
        },
      },
      required: ["steps"],
    },
    run: async (args) => {
      let steps = args.steps
      // steps 를 JSON 글자로 보내는 두뇌가 있다(11-10 Haiku) — 뜻이 하나로 정해지므로 풀어서 받는다(W19)
      if (typeof steps === "string") {
        const raw = steps
        try {
          steps = JSON.parse(raw)
        } catch (e) {
          // 앞부분이 완전한 JSON 이고 남는 글자가 닫는 괄호·빈칸뿐이면 앞부분을 받는다(11-10 Haiku — 뜻이 하나)
          const at = /position (\d+)/.exec(e instanceof Error ? e.message : "")
          if (at && /^[\s\]}]*$/.test(raw.slice(Number(at[1])))) steps = JSON.parse(raw.slice(0, Number(at[1])))
          else throw new WrapperError("invalid_argument", `steps 는 글자가 아니라 단계 목록(배열)이다 — 받은 글자가 JSON 으로도 풀리지 않는다(${e instanceof Error ? e.message.slice(0, 100) : e})`)
        }
      }
      if (!Array.isArray(steps) || !steps.length) throw new WrapperError("invalid_argument", "steps 는 단계 목록 [{tool, args, as?}, …] — 할 일이 없으면 batch 를 부르지 않는다")
      if (steps.length > maxSteps) throw new WrapperError("invalid_argument", `한 번에 ${maxSteps} 단계까지(받은 것 ${steps.length})`)
      const byName = new Map(getTools().map((t) => [t.name, t]))
      const results: unknown[] = []
      for (const [index, step] of steps.entries()) {
        const { tool, args: a, as } = (step ?? {}) as { tool?: string; args?: Record<string, unknown>; as?: string }
        const target = tool && tool !== "batch" ? byName.get(tool) : undefined
        try {
          if (!target) throw new WrapperError("invalid_argument", `없는 도구: ${tool}`)
          results.push(await target.run(resolveRefs(a ?? {}, results, index) as Record<string, unknown>))
          if (as) names.set(as, results[index])
        } catch (e) {
          const error = e instanceof WrapperError ? `${e.code}: ${e.message}` : `engine: ${e instanceof Error ? e.message : e}`
          return { completed: index, results, failed: { step: index, tool, error } }
        }
      }
      return { completed: steps.length, results }
    },
  }
}

/** 가벼운 모드(W12) — 도구 목록을 batch 하나로 줄이고 안쪽 도구는 한 줄 요약으로 batch 설명에 싣는다. */
export function leanTools(tools: Tool[]): Tool[] {
  const batch = tools.find((t) => t.name === "batch")!
  const lines = tools
    .filter((t) => t.name !== "batch")
    .map((t) => {
      const s = t.inputSchema as { properties?: Record<string, { enum?: string[]; description?: string }>; required?: string[] }
      const req = new Set(s.required ?? [])
      const params = Object.entries(s.properties ?? {}).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}${v.enum ? `=${v.enum.join("|")}` : ""}${/0–100/.test(v.description ?? "") ? "(0–100)" : ""}`)
      return `${t.name}(${params.join(", ")}): ${t.description.split(/(?<=[.。])\s/)[0]!.slice(0, 100)}`
    })
  return [{ ...batch, description: `${batch.description}\n도구:\n${lines.join("\n")}` }]
}
