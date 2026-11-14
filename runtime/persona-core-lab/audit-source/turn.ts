// 표준 하네스 훅 길(A) — `POST /api/v1_0/turn/before` ← UserPromptSubmit · `POST /api/v1_0/turn/after` ← Stop
//   계약: harness/HOOK_CONTRACT.md v0.1 · 구현 방식: core/harnessTurn.ts(처리기를 디코드 자리에서 멈췄다 잇는다 · /chat 판단 0 복사)
//   실행기 연결: Elda CLI http 훅(코딩고래 b632690) 또는 틀 hooks 모듈 — 둘 다 이 두 문을 그대로 부른다.
//   ⛔ 두 층 기준(테이 5-1 · 풀스택 v0.816): 안쪽(TEI) 실패는 턴 실패가 아니다(처리기가 이미 그렇게 돈다) ·
//     이 문 **자체**가 5xx/시간 초과면 실행기가 입력을 막는다(fail-closed) ⇒ 여기서는 애매하면 5xx 로 솔직히 실패한다.
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { openTurn, deliverAnswer, type Pause } from '../../core/harnessTurn';
import { originOf } from '../v1/brain';
import { logger } from '../../core/logger';

export const turnRouter = Router();
const SELF = `http://127.0.0.1:${process.env.PORT ?? 3200}/api/v1_0/chat`;
const BEFORE_MS = Number(process.env.HARNESS_BEFORE_MS ?? 7000);     // 계약 §1 — 실행기 상한(8 s)보다 짧게
const AFTER_MS = Number(process.env.HARNESS_AFTER_MS ?? 4500);       // 계약 §2 — Stop 상한(5 s)보다 짧게

/** 실행기 두뇌 칸 이름 — 관문 등급(small)이 있으면 등급으로, 없으면 실제 모델 이름 그대로(관문이 받는다) */
const brainOf = (model: string): string => model === 'claude-haiku-5-5' ? 'eldacore:small' : model === 'giant' ? 'eldacore:giant' : `eldacore:${model}`;

/** 처리기가 만든 메시지에서 실행기에 줄 맥락 — system + 이번 턴 user(근거·제약 포함). ⛔ 대화 기록은 빼고(실행기가 든다) */
function contextOf(p: Pause): string {
    const sys = p.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const last = [...p.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return `[지침]\n${sys}\n\n[이번 턴 — 근거와 질문]\n${last}`;
}

type Ended = { kind: 'done'; full: string; model: string; gate?: unknown } | { kind: 'error'; error: string };
/** H57 관측 칸 — 세션의 마지막 턴 memory_gate(turn/after 가 돌려준다 · 리소너 S4.4) */
const gates = new Map<string, unknown>();

turnRouter.post('/api/v1_0/turn/before', async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const session = typeof b.session_id === 'string' && /^[\w.:-]{1,120}$/.test(b.session_id) ? b.session_id : null;
    // ★ v0.818(풀스택 161d8251e4) — 훅 길은 칸을 가른다: prompt = **사람 말만** · 알림 = `notifications:[{origin:{kind}, text}]`
    //   알림만으로 도는 턴은 prompt:"" + notifications ⇒ 그 턴은 사람 말이 아니다(기억 0 · 맞대기 0)
    const human = typeof b.prompt === 'string' ? b.prompt : '';
    const notes = Array.isArray(b.notifications) ? (b.notifications as { text?: unknown }[]).map((n) => String(n?.text ?? '')).filter(Boolean) : [];
    const prompt = human.trim() ? human : notes.join('\n');
    if (!session || !prompt.trim()) { res.status(400).json({ error: 'session_id and prompt (or notifications) required' }); return; }
    const token = randomUUID();
    const origin: { kind: string; memoryText?: string } = !human.trim() ? { kind: notes.length ? 'notification' : 'human' }
        : (b.origin && typeof b.origin === 'object' && typeof (b.origin as { kind?: unknown }).kind === 'string'
           && (b.origin as { kind: string }).kind !== 'human') ? { kind: (b.origin as { kind: string }).kind }
        : notes.length ? { kind: 'mixed', memoryText: human }
        : originOf(req, human);
    // ★ 레인(풀스택 c4ad70bedb) — 도구 서빙 턴(간판·업체 · B 갈래)은 훅 설정 headers 에 `x-elda-lane: serve-…` 를 박는다
    //   ⇒ 채팅 갈래(거인 등급)를 고르지 않고, 채팅 지침(「[컨텍스트]에 있는 값만…」)을 맥락으로 내지 않는다.
    //     위험 바닥·정해진 답(block+reason)·기억·원장은 그대로(판단은 여전히 오케 한 자리).
    const lane = (req.header('x-elda-lane') ?? '').trim();
    const serveLane = lane.startsWith('serve');
    const { pausedP } = openTurn(session, token);
    const t0 = Date.now();

    // 처리기를 띄운다 — 끝까지 읽어야 처리기가 이어 간다(멈춤 뒤에도 이 읽기는 계속 돈다)
    const endedP: Promise<Ended> = (async () => {
        try {
            const r = await fetch(SELF, { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ question: prompt, conversation_id: session, harness_session: session, origin_kind: origin.kind,
                                       ...(serveLane ? { harness_lane: lane } : {}),
                                       ...(origin.memoryText ? { memory_text: origin.memoryText } : {}) }) });
            if (!r.ok || !r.body) return { kind: 'error', error: `chat_http_${r.status}` };
            const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
            let ended: Ended | null = null;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let nl: number;
                while ((nl = buf.indexOf('\n')) !== -1) {
                    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                    if (!line.startsWith('data:')) continue;
                    let ev: Record<string, unknown>; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
                    if (ev.stage === 'done' && !ended) { ended = { kind: 'done', full: String(ev.full ?? ''), model: String(ev.model ?? ''), gate: ev.memory_gate }; gates.set(session, ev.memory_gate); }
                    if (ev.stage === 'error' && !ended) ended = { kind: 'error', error: String(ev.error ?? 'error') };
                }
            }
            return ended ?? { kind: 'error', error: 'chat_stream_ended_without_done' };
        } catch (e) { return { kind: 'error', error: (e as Error).message ?? 'chat_unreachable' }; }
    })();

    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), BEFORE_MS).unref());
    const first = await Promise.race([pausedP.then((p) => ({ paused: p })), endedP.then((e) => ({ ended: e })), timeout]);
    const ms = Date.now() - t0;

    if (first === 'timeout') {
        logger.warn('harness.before.timeout', { session, token, ms });
        res.status(504).json({ error: 'turn_before_timeout' }); return;            // ⇒ 실행기 fail-closed
    }
    if ('paused' in first) {
        // ① 두뇌가 답한다
        if (serveLane) {
            // 도구 서빙 턴 — 맥락·두뇌를 안 바꾼다(실행기 자기 지침·도구로 간다)
            logger.info('harness.before.serve_pass', { session, token, ms, lane, origin: origin.kind });
            res.json({ elda: { turn_token: token, lane } }); return;
        }
        logger.info('harness.before.context', { session, token, ms, model: first.paused.model, origin: origin.kind });
        res.json({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: contextOf(first.paused),
                                         brain: brainOf(first.paused.model) },
                   elda: { turn_token: token } });
        return;
    }
    const e = first.ended;
    if (e.kind === 'done' && e.full) {
        // ② 오케가 답을 정했다(위험 바닥 · NPC · 정체성 · 거인) — 두뇌 없이 그 글로
        logger.info('harness.before.answered', { session, token, ms, model: e.model });
        res.json({ decision: 'block', reason: e.full, elda: { turn_token: token, answered_by: e.model || 'eldacore', memory_gate: e.gate ?? null } }); return;
    }
    if (e.kind === 'error' && e.error === 'input_too_long') { res.json({ decision: 'block' }); return; }   // ③
    logger.warn('harness.before.failed', { session, token, ms, why: e.kind === 'error' ? e.error : 'empty_answer' });
    res.status(503).json({ error: e.kind === 'error' ? e.error : 'empty_answer' });             // ⇒ 실행기 fail-closed
});

turnRouter.post('/api/v1_0/turn/after', async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const session = typeof b.session_id === 'string' ? b.session_id : '';
    const answer = typeof b.last_assistant_message === 'string' ? b.last_assistant_message : '';
    const r = await deliverAnswer(session, { ok: !!answer, full: answer, model: 'executor' }, AFTER_MS);
    logger.info('harness.after', { session, result: r, stop_hook_active: b.stop_hook_active === true, len: answer.length });
    // ⛔ 지금 오케의 답 뒤 검사는 「재기만 한다」 ⇒ 막지 않는다(계약 §2 · 막는 것은 사용자 결정으로 하나씩)
    // 처리기 끝과 done 줄 읽기가 엇갈릴 수 있다 ⇒ 관측 칸을 잠깐(≤600 ms) 기다린다
    for (let i = 0; i < 12 && r === 'resumed' && !gates.has(session); i++) await new Promise((ok) => setTimeout(ok, 50));
    const gate = gates.get(session); gates.delete(session);
    res.json(gate !== undefined ? { elda: { memory_gate: gate } } : {});
});
