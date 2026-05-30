import { Agent, fetch as udfetch } from 'undici';
import { randomBytes } from 'node:crypto';

// hellcat에서 LAN으로 p38 게이트웨이를 때리는 부하 생성기.
// 단일 활성 run만 허용(둘 동시는 측정 오염).

export type Op = 'embed' | 'rerank';
export type StressCfg = {
  op: Op;
  concurrency: number;
  batch: number;
  duration: number; // seconds; 0 = STOP까지 무한
  corpusSize: number;
};

const CORPUS = [
  '전면간판 LED 모듈 재질', '채널간판 조립 방법', '돌출간판 이격 규정',
  '간판 글자 폰트와 색상', '간판 설치 안전 가이드', '아크릴 마감재 처리',
  '알루미늄 복합판 가공', '간판 야간 조명 효율', '간판 도면 표준 양식',
  '간판 허가 신청 절차', '전기 공사 안전 점검', '간판 청소 유지보수',
  '도시 경관 가이드라인', '간판 디자인 트렌드', '한국 전통 간판 양식',
  '카페 간판 사례 분석', '편의점 간판 표준', '음식점 간판 폰트',
  '바닥 표지판 설치', '벽면 간판 부착 방법', '간판 부식 방지 처리',
  '전광판 픽셀 피치', '비전기 간판 시인성', '간판 도장 작업 절차',
];

type State = {
  id: string;
  cfg: StressCfg;
  target: string;
  startTs: number;
  endTs: number | null;
  status: 'running' | 'done' | 'error';
  sent: number; done: number; inflight: number;
  ok: number; e429: number; eOther: number;
  rolling: number[];
  hist: { rps: number[]; p50: number[]; p95: number[]; p99: number[] };
  lastSampleTs: number;
  lastSampleDone: number;
};

let current: State | null = null;
let stopFlag = false;
let agent: Agent | null = null;

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

export function snapshot() {
  if (!current) return null;
  const s = current;
  const sorted = [...s.rolling].sort((a, b) => a - b);
  const now = s.endTs ?? Date.now();
  const elapsed = (now - s.startTs) / 1000;
  return {
    id: s.id, status: s.status, cfg: s.cfg, target: s.target,
    elapsed,
    sent: s.sent, done: s.done, inflight: s.inflight,
    ok: s.ok, e429: s.e429, eOther: s.eOther,
    p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99),
    rpsAvg: elapsed > 0 ? s.done / elapsed : 0,
    rpsNow: s.hist.rps.at(-1) ?? 0,
    hist: s.hist,
  };
}

export function startRun(
  cfg: StressCfg,
  targetOverride?: string,
): { ok: true; id: string } | { ok: false; runningId: string } {
  if (current && current.status === 'running') return { ok: false, runningId: current.id };
  const target = targetOverride || process.env.TEI_URL || 'http://192.168.0.18:8000';
  if (!agent) agent = new Agent({ connections: 4096, pipelining: 1, keepAliveTimeout: 30_000 });

  const id = `run_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const s: State = {
    id, cfg, target, startTs: Date.now(), endTs: null, status: 'running',
    sent: 0, done: 0, inflight: 0, ok: 0, e429: 0, eOther: 0,
    rolling: [], hist: { rps: [], p50: [], p95: [], p99: [] },
    lastSampleTs: Date.now(), lastSampleDone: 0,
  };
  current = s;
  stopFlag = false;
  void runJob(s);
  return { ok: true, id };
}

export function stopRun(): boolean {
  if (!current || current.status !== 'running') return false;
  stopFlag = true;
  return true;
}

async function runJob(s: State): Promise<void> {
  const sampler = setInterval(() => {
    const now = Date.now();
    const dt = (now - s.lastSampleTs) / 1000;
    const dDone = s.done - s.lastSampleDone;
    const rps = dt > 0 ? dDone / dt : 0;
    s.lastSampleTs = now;
    s.lastSampleDone = s.done;
    if (s.rolling.length > 5000) s.rolling = s.rolling.slice(-5000);
    const sorted = [...s.rolling].sort((a, b) => a - b);
    s.hist.rps.push(Number(rps.toFixed(1)));
    s.hist.p50.push(Math.round(pct(sorted, 50)));
    s.hist.p95.push(Math.round(pct(sorted, 95)));
    s.hist.p99.push(Math.round(pct(sorted, 99)));
    for (const k of ['rps', 'p50', 'p95', 'p99'] as const) {
      if (s.hist[k].length > 300) s.hist[k].shift();
    }
  }, 1000);

  const pool = CORPUS.slice(0, Math.max(1, Math.min(CORPUS.length, s.cfg.corpusSize)));
  const pick = (n: number) => Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);

  const fire = async () => {
    const texts = pick(s.cfg.batch);
    const path = s.cfg.op === 'embed' ? '/api/embed' : '/rerank';
    const body = s.cfg.op === 'embed'
      ? { model: 'BAAI/bge-m3', input: texts }
      : {
          model: 'BAAI/bge-reranker-v2-m3',
          query: texts[0],
          texts: texts.slice(1).length ? texts.slice(1) : [texts[0]],
        };
    s.sent++;
    s.inflight++;
    const t0 = performance.now();
    try {
      const r = await udfetch(`${s.target}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        dispatcher: agent!,
      });
      try {
        await r.text(); // drain
      } catch {
        /* ignore */
      }
      const lat = performance.now() - t0;
      s.rolling.push(lat);
      if (r.status === 429) s.e429++;
      else if (!r.ok) s.eOther++;
      else s.ok++;
    } catch {
      s.eOther++;
    } finally {
      s.inflight--;
      s.done++;
    }
  };

  async function worker() {
    while (!stopFlag) {
      if (s.cfg.duration > 0 && (Date.now() - s.startTs) / 1000 >= s.cfg.duration) break;
      await fire();
    }
  }

  try {
    await Promise.all(Array.from({ length: s.cfg.concurrency }, () => worker()));
    s.status = 'done';
  } catch {
    s.status = 'error';
  } finally {
    s.endTs = Date.now();
    clearInterval(sampler);
  }
}
