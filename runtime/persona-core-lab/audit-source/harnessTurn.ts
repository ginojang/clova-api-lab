// harnessTurn — 표준 하네스 훅 길(A)의 「멈췄다 잇기」 (2026-11-13 · HOOK_CONTRACT v0.1 · HARNESS_PLAN S4.1)
//
//   ★ 왜 이 모양인가: `/chat` 처리기는 1,900줄이 한 함수 안의 지역 상태로 얽혀 있다. 그것을 턴 앞·턴 뒤 두 함수로 가르면
//     같은 판단이 두 벌이 된다. ⇒ 처리기를 **그대로** 돌리고, **디코드 자리에서만 멈춘다**:
//       turn/before → 처리기 시작(하네스 토큰) → 디코드 자리에서 맥락을 내보내고 기다림 → before 가 그 맥락을 실행기에 돌려준다
//       실행기 두뇌가 답함 → Stop 훅 → turn/after 가 그 답을 넣어 준다 → 처리기가 이어서 판정·기록·기억을 마친다
//     디코드 전에 처리기가 스스로 답을 낸 턴(위험 바닥 거절 · NPC 결정론 · 정체성 · 거인)은 멈추지 않고 끝난다
//       ⇒ before 가 그 답을 block+reason 으로 돌려준다(실행기가 두뇌 없이 손님에게 낸다 · v0.815).
//   ⛔ 세션 하나에 열린 턴은 하나(실행기 = 대화 하나 = 프로세스 하나 · H1). Stop 훅은 session_id 만 준다 ⇒ 세션으로 찾는다.
import { logger } from './logger';

export type Pause = { messages: { role: string; content: string }[]; model: string };
export type Answer = { ok: boolean; full: string; model: string };
type Slot = {
    token: string;
    paused?: (p: Pause) => void;          // before 가 기다리는 「디코드 자리에 왔다」
    answer?: (a: Answer) => void;         // 처리기가 기다리는 「두뇌의 답」
    finished?: () => void;                // after 가 기다리는 「처리기가 끝났다」
    finishedP: Promise<void>;
    at: number;
};
const slots = new Map<string, Slot>();     // key = session_id
const ANSWER_WAIT_MS = Number(process.env.HARNESS_ANSWER_WAIT_MS ?? 180000);
const TTL_MS = 10 * 60 * 1000;

function sweep(): void {
    const now = Date.now();
    for (const [k, s] of slots) if (now - s.at > TTL_MS) { s.answer?.({ ok: false, full: '', model: 'none' }); slots.delete(k); }
}

/** turn/before 가 연다 — 이전 열린 턴이 있으면 버린다(답이 안 왔다 = 실행기가 그 턴을 접었다) */
export function openTurn(sessionId: string, token: string): { pausedP: Promise<Pause>; finishedP: Promise<void> } {
    sweep();
    const old = slots.get(sessionId);
    if (old) { old.answer?.({ ok: false, full: '', model: 'none' }); logger.warn('harness.turn_abandoned', { session: sessionId, token: old.token }); }
    let finished!: () => void;
    const finishedP = new Promise<void>((r) => { finished = r; });
    const slot: Slot = { token, finishedP, finished, at: Date.now() };
    const pausedP = new Promise<Pause>((r) => { slot.paused = r; });
    slots.set(sessionId, slot);
    return { pausedP, finishedP };
}

/** 처리기가 디코드 자리에서 부른다 — 맥락을 내보내고 두뇌의 답을 기다린다(상한 넘으면 실패한 답) */
export async function pauseForBrain(sessionId: string, p: Pause): Promise<Answer> {
    const s = slots.get(sessionId);
    if (!s?.paused) return { ok: false, full: '', model: p.model };
    const ansP = new Promise<Answer>((r) => { s.answer = r; });
    s.paused(p); s.paused = undefined;
    const timeout = new Promise<Answer>((r) => setTimeout(() => r({ ok: false, full: '', model: p.model }), ANSWER_WAIT_MS).unref());
    return Promise.race([ansP, timeout]);
}

/** 처리기가 끝날 때(어느 갈래든) */
export function finishTurn(sessionId: string): void {
    const s = slots.get(sessionId);
    if (!s) return;
    s.finished?.();
    if (!s.answer) slots.delete(sessionId);     // 멈추지 않고 끝난 턴(답을 오케가 냈다)
}

/** turn/after 가 부른다 — 두뇌의 답을 넣고 처리기가 마칠 때까지 기다린다(상한) */
export async function deliverAnswer(sessionId: string, a: Answer, waitMs: number): Promise<'resumed' | 'no_turn' | 'timeout'> {
    const s = slots.get(sessionId);
    if (!s?.answer) return 'no_turn';
    s.answer(a); s.answer = undefined;
    const done = await Promise.race([s.finishedP.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), waitMs).unref())]);
    slots.delete(sessionId);
    return done ? 'resumed' : 'timeout';
}

export const isHarnessTurn = (sessionId: unknown): sessionId is string => typeof sessionId === 'string' && slots.has(sessionId);
