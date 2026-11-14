// 줄 형식(H1~H4) — stdout 에는 이 줄만 쓴다. 다른 출력(디버그)은 stderr 로.
let seq = 0

/** H3 — {v:1, seq, ts, t, data}. seq 는 1 부터 빠짐없이 */
export function emit(t: string, data: Record<string, unknown> = {}): void {
  seq += 1
  process.stdout.write(JSON.stringify({ v: 1, seq, ts: new Date().toISOString(), t, data }) + "\n")
}

/** H4 text_delta — 100ms 로 묶어 낸다(글자마다 내지 않는다) */
export class DeltaBuffer {
  private buf = ""
  private timer: NodeJS.Timeout | null = null
  push(s: string) {
    this.buf += s
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 100)
  }
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.buf) emit("text_delta", { text: this.buf })
    this.buf = ""
  }
}

export const log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n")
