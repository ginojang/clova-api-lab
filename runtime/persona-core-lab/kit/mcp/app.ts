// 틀의 '앱' — 진짜 래퍼에서는 이 자리가 헤드리스 앱 드라이버다(VectorCraft·Unity·…).
// 여기서는 규격을 보이기 위한 작은 메모판: 대지(mm) 위에 메모를 붙이고 옮기고 지운다. 되돌리기 한 단계 = 도구 한 번.
import { WrapperError } from "./server.ts"

export interface Note { id: number; text: string; x: number; y: number; width: number; height: number }
export interface Doc { width: number; height: number; notes: Note[]; nextId: number }

export class MemoApp {
  doc: Doc | null = null
  private undo: string[] = []

  private need(): Doc {
    if (!this.doc) throw new WrapperError("not_found", "열린 문서가 없다 — document_create 또는 document_open 먼저")
    return this.doc
  }
  /** 바꾸기 전에 부른다 — 실패하면 아무것도 바꾸지 않도록 검사는 모두 이 앞에서 끝낸다(W17). */
  private snapshot() {
    if (this.doc) this.undo.push(JSON.stringify(this.doc))
  }

  create(width: number, height: number) {
    this.snapshot()
    this.doc = { width, height, notes: [], nextId: 1 }
  }
  load(json: string) {
    let d: Doc
    try {
      d = JSON.parse(json) as Doc
    } catch {
      throw new WrapperError("invalid_argument", "메모판 문서(JSON)가 아니다")
    }
    if (typeof d.width !== "number" || !Array.isArray(d.notes)) throw new WrapperError("invalid_argument", "메모판 문서 모양이 아니다(width·notes)")
    this.snapshot()
    this.doc = d
  }
  add(text: string, x: number, y: number): Note {
    const d = this.need()
    const note: Note = { id: d.nextId, text, x, y, width: Math.max(10, text.length * 4), height: 8 }
    this.snapshot()
    d.notes.push(note)
    d.nextId++
    return note
  }
  find(ids: number[]): Note[] {
    const d = this.need()
    const missing = ids.filter((id) => !d.notes.some((n) => n.id === id))
    if (missing.length) throw new WrapperError("not_found", `없는 메모 ${missing.join(", ")} — 지금 있는 메모: ${d.notes.map((n) => n.id).join(", ") || "없음"}`)
    return ids.map((id) => d.notes.find((n) => n.id === id)!)
  }
  move(ids: number[], dx: number, dy: number) {
    const notes = this.find(ids) // 먼저 다 확인
    this.snapshot()
    for (const n of notes) (n.x += dx), (n.y += dy)
  }
  remove(ids: number[]) {
    this.find(ids)
    this.snapshot()
    const d = this.need()
    d.notes = d.notes.filter((n) => !ids.includes(n.id))
  }
  toText(): string {
    const d = this.need()
    return [`메모판 ${d.width}x${d.height}mm`, ...d.notes.map((n) => `#${n.id} (${n.x},${n.y}) ${n.text}`)].join("\n") + "\n"
  }
}
