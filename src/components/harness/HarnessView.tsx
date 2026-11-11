import { useCallback, useEffect, useRef, useState } from 'react';
import ComparisonResults from './ComparisonResults';
import Mode2Results from './Mode2Results';
import {
  harnessRequest, HarnessHttpError, loadAccess, setAccess, rememberSession, savedSession,
  type HarnessEvent, type HarnessFile, type HarnessInfo, type HarnessSnapshot, type HarnessProviderId,
} from '../../api/harnessClient';

const EXAMPLES = [
  { label: '파일 만들기', prompt: 'artifact_write를 정확히 한 번 호출하세요. 인자 path는 "comparison.txt", 인자 text는 JSON 문자열 "CLOVA 비교 시험 — 처음 내용"입니다. 따옴표는 JSON 표기이며 파일 내용에 넣지 마세요. 마침표·줄바꿈·다른 글자를 추가하지 마세요. 저장 후 짧게 완료를 알려 주세요.' },
  { label: '내용 수정', prompt: 'artifact_write를 정확히 한 번 호출하세요. 인자 path는 "comparison.txt", 인자 text는 JSON 문자열 "CLOVA 비교 시험 — 수정 내용"입니다. 따옴표는 JSON 표기이며 파일 내용에 넣지 마세요. 마침표·줄바꿈·다른 글자를 추가하지 마세요. 저장 후 짧게 완료를 알려 주세요.' },
  { label: '되돌리기', prompt: '방금 comparison.txt에 한 수정을 artifact_undo 도구로 정확히 한 번 되돌리세요. artifact_write로 다시 쓰지 마세요. 이어서 artifact_read로 comparison.txt를 읽어 처음 내용으로 돌아왔는지 확인하고 짧게 알려 주세요.' },
  { label: '오류 확인', prompt: 'missing.txt를 읽어 주세요. 파일이 없다면 새로 만들지 말고 오류를 설명해 주세요.' },
];
const button = 'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40';
const statusNames: Record<string, string> = { starting: '연결 중', running: '실행 중', awaiting_approval: '도구 승인 대기', idle: '입력 대기', invalid: '새 테스트 필요', closed: '종료됨' };
function message(error: unknown) { return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'; }
function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function EventCard({ event }: { event: HarnessEvent }) {
  const d = event.data;
  if (event.t === 'user_prompt' || event.t === 'text') return (
    <div className={`rounded-xl border px-4 py-3 ${event.t === 'user_prompt' ? 'ml-6 border-emerald-900/70 bg-emerald-950/25' : 'mr-4 border-slate-800 bg-slate-900'}`}>
      <div className="mb-1 text-xs font-semibold text-slate-400">{event.t === 'user_prompt' ? '나' : '모델'}</div>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{String(d.text ?? '')}</div>
    </div>
  );
  if (event.t === 'tool_call' || event.t === 'tool_result') return (
    <details className={`rounded-lg border px-3 py-2 text-xs ${event.t === 'tool_result' && !d.ok ? 'border-amber-800/70 bg-amber-950/20 text-amber-200' : 'border-slate-800 bg-slate-900/40 text-slate-400'}`}>
      <summary className="cursor-pointer break-all">
        {event.t === 'tool_call' ? '도구 호출' : d.ok ? '도구 완료' : '도구 거절·오류'} · {String(d.tool ?? '').replace('clova__', '')}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-300">{JSON.stringify(event.t === 'tool_call' ? d.input : d.output, null, 2)}</pre>
    </details>
  );
  if (event.t === 'error' || event.t === 'runner_closed') return (
    <div role="status" className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">{d.code === 'interrupted' ? (String(d.message).includes('budget_exceeded') ? '요청 시간이 초과되어 중단했습니다.' : '요청을 중단했습니다.') : String(d.message ?? '실행 중 오류가 발생했습니다.')}</div>
  );
  if (event.t === 'turn_end') return <div className="px-1 text-xs text-slate-500">{d.ok ? '응답 완료' : '요청 종료'} · {(Number(d.durationMs ?? 0) / 1000).toFixed(1)}초 · 모델 {String(d.turns)}회 · 도구 {String(d.toolCalls)}회</div>;
  return null;
}

export default function HarnessView() {
  const [access, setAccessInput] = useState('');
  const [unlocked, setUnlocked] = useState(() => !!loadAccess());
  const [info, setInfo] = useState<HarnessInfo | null>(null);
  const [mode, setMode] = useState<'live' | 'scripted'>('live');
  const [harnessMode, setHarnessMode] = useState<'2' | '3'>('2');
  const [provider, setProvider] = useState<HarnessProviderId>('groq');
  const [model, setModel] = useState('groq:openai/gpt-oss-120b');
  const [snap, setSnap] = useState<HarnessSnapshot | null>(null);
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(() => savedSession());
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<HarnessFile[]>([]);
  const [selected, setSelected] = useState<{ name: string; text: string; bytes: number } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const cursor = useRef(0);
  const currentId = useRef(sessionId);
  const selectedName = useRef<string | null>(null);
  const fileRequest = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = pending || snap?.state === 'running' || snap?.state === 'starting' || snap?.state === 'awaiting_approval';
  const providerInfo = info?.providers.find(item => item.id === provider);
  const canRun = mode === 'scripted' || !!providerInfo?.configured;

  useEffect(() => { currentId.current = sessionId; }, [sessionId]);
  useEffect(() => {
    const unlockFromLink = () => { if (loadAccess()) setUnlocked(true); };
    window.addEventListener('hashchange', unlockFromLink);
    return () => window.removeEventListener('hashchange', unlockFromLink);
  }, []);
  const merge = useCallback((next: HarnessSnapshot) => {
    if (currentId.current && currentId.current !== next.id) return;
    setSnap(next); setMode(next.mode); setHarnessMode(next.harnessMode ?? '2');
    setProvider(next.provider ?? 'clova');
    setModel(next.mode === 'scripted' ? 'HCX-005' : next.provider === 'clova' || !next.provider ? next.model.replace(/^clova:/, '') : next.model);
    cursor.current = Math.max(cursor.current, next.cursor);
    setEvents(old => {
      const seen = new Set(old.map(e => e.cursor));
      return [...old, ...next.events.filter(e => !seen.has(e.cursor))].slice(-1200);
    });
  }, []);
  const openFile = useCallback(async (id: string, name: string) => {
    const request = ++fileRequest.current;
    selectedName.current = name; setFileBusy(true);
    try {
      const result = await harnessRequest<{ name: string; text: string; bytes: number }>(`/sessions/${id}/file?path=${encodeURIComponent(name)}`);
      if (currentId.current === id && request === fileRequest.current) setSelected(result);
    } catch (e) { if (request === fileRequest.current && currentId.current === id) setError(message(e)); }
    finally { if (request === fileRequest.current) setFileBusy(false); }
  }, []);
  const refreshFiles = useCallback(async (id: string) => {
    const result = await harnessRequest<{ files: HarnessFile[] }>(`/sessions/${id}/files`);
    if (currentId.current !== id) return;
    setFiles(result.files);
    const name = result.files.find(f => f.name === selectedName.current)?.name ?? result.files[0]?.name;
    if (name) await openFile(id, name);
    else { selectedName.current = null; setSelected(null); }
  }, [openFile]);

  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    harnessRequest<HarnessInfo>('/info').then(data => {
      if (!active) return;
      setInfo(data);
      setError('');
    }).catch(e => { if (active) { setError(message(e)); if (e instanceof HarnessHttpError && e.status === 401) setUnlocked(false); } });
    return () => { active = false; };
  }, [unlocked]);

  useEffect(() => {
    if (!sessionId || !unlocked) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let lastFilesCursor = -1;
    const poll = async () => {
      let delay = 800;
      try {
        const next = await harnessRequest<HarnessSnapshot>(`/sessions/${sessionId}?after=${cursor.current}`);
        if (!active) return;
        merge(next);
        if (next.state !== 'running' && next.cursor !== lastFilesCursor) { lastFilesCursor = next.cursor; await refreshFiles(sessionId); }
        delay = next.state === 'running' ? 600 : 2500;
      } catch (e) {
        if (!active) return;
        setError(message(e)); delay = 4000;
        if (e instanceof HarnessHttpError && e.status === 404) { rememberSession(null); setSessionId(null); setSnap(null); return; }
      }
      if (active) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, unlocked, merge, refreshFiles]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [events.length]);

  async function send() {
    if (!prompt.trim() || busy || !info || !canRun) return;
    setPending(true); setError('');
    try {
      let id = sessionId;
      if (!id) {
        const created = await harnessRequest<HarnessSnapshot>('/sessions', { method: 'POST', body: JSON.stringify({ mode, harnessMode, provider: mode === 'scripted' ? 'clova' : provider, model: mode === 'scripted' ? 'HCX-005' : model }) });
        id = created.id; currentId.current = id; cursor.current = 0;
        setEvents([]); merge(created); rememberSession(id); setSessionId(id);
      }
      await harnessRequest(`/sessions/${id}/prompt`, { method: 'POST', body: JSON.stringify({ text: prompt }) });
      setPrompt('');
      const next = await harnessRequest<HarnessSnapshot>(`/sessions/${id}?after=${cursor.current}`); merge(next);
    } catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  async function stop() {
    if (!sessionId) return;
    try { await harnessRequest(`/sessions/${sessionId}/interrupt`, { method: 'POST', body: '{}' }); }
    catch (e) { setError(message(e)); }
  }
  async function approve(allow: boolean) {
    if (!sessionId || !snap?.pendingApproval || pending) return;
    setPending(true); setError('');
    try {
      await harnessRequest(`/sessions/${sessionId}/approve`, { method: 'POST', body: JSON.stringify({ approvalId: snap.pendingApproval.approvalId, allow }) });
      merge(await harnessRequest<HarnessSnapshot>(`/sessions/${sessionId}?after=${cursor.current}`));
    } catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  async function reset() {
    setPending(true); setError('');
    try {
      if (sessionId) await harnessRequest(`/sessions/${sessionId}`, { method: 'DELETE' }).catch(e => { if (!(e instanceof HarnessHttpError && e.status === 404)) throw e; });
      rememberSession(null); currentId.current = null; cursor.current = 0; selectedName.current = null;
      fileRequest.current++; setFileBusy(false);
      setSessionId(null); setSnap(null); setEvents([]); setFiles([]); setSelected(null);
      setPrompt(mode === 'live' ? EXAMPLES[0].prompt : '작업장 목록을 확인해 주세요.');
    } catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  async function exportReport() {
    if (!sessionId) return;
    try { const report = await harnessRequest(`/sessions/${sessionId}/report`); download(`harness-test-${sessionId}.json`, JSON.stringify(report, null, 2), 'application/json'); }
    catch (e) { setError(message(e)); }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto p-4 lg:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">하네스 테스트</h1>
          <p className="mt-1 text-sm text-slate-400">새 API 비교는 ② 자체 하네스에서 진행합니다. 같은 파일 과제로 도구 실행과 결과를 확인하세요.</p>
          <p className="mt-1 text-xs text-slate-500">웹에서는 자체 하네스를 직접 실행합니다. Elda-CLI 연결은 별도 자동 검사로 검증합니다.</p>
        </div>
        <div role="status" className={`rounded-full border px-3 py-1.5 text-xs ${snap?.state === 'running' ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
          {pending ? '연결 중…' : snap ? statusNames[snap.state] : '테스트 준비'}
        </div>
      </div>
      {!unlocked ? (
        <form onSubmit={e => { e.preventDefault(); setAccess(access); setUnlocked(true); }} className="mx-auto mt-8 w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-medium">테스트 전용 접속</h2>
          <p className="mt-2 text-sm text-slate-400">전달받은 테스트 링크를 열면 바로 사용할 수 있습니다. 접속 코드가 있다면 아래에 입력하세요.</p>
          <label className="mt-5 block text-sm text-slate-300" htmlFor="harness-access">테스트 접속 코드</label>
          <input id="harness-access" type="password" autoComplete="off" value={access} onChange={e => setAccessInput(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
          <button disabled={!access.trim()} className={`${button} mt-3 w-full`} type="submit">테스트 열기</button>
          {error && <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
        </form>
      ) : (
        <>
          <Mode2Results />
          <ComparisonResults />
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <label htmlFor="harness-provider" className="text-xs text-slate-400">API 공급자</label>
            <select id="harness-provider" value={provider} disabled={!info || !!sessionId || pending || mode === 'scripted'} onChange={e => {
              const id = e.target.value as HarnessProviderId;
              setProvider(id); setModel(info?.providers.find(item => item.id === id)?.models[0]?.id ?? '');
              if (id !== 'clova') setHarnessMode('2');
            }} className="min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-60">
              {(info?.providers ?? [{ id: 'groq', label: 'Groq', configured: false }]).map(item => <option key={item.id} value={item.id}>{item.label}{!item.configured ? ' · 키 미등록' : ''}</option>)}
            </select>
            <label htmlFor="harness-model" className="text-xs text-slate-400">모델</label>
            <select id="harness-model" value={model} disabled={!info || !!sessionId || pending || mode === 'scripted'} onChange={e => setModel(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-60">
              {providerInfo?.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <label htmlFor="harness-kind" className="text-xs text-slate-400">하네스 모드</label>
            <select id="harness-kind" value={harnessMode} disabled={!!sessionId || pending} onChange={e => setHarnessMode(e.target.value as '2' | '3')} className="min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-60">
              <option value="2">② 자체 하네스 · 도구 승인</option>
              <option value="3" disabled={mode === 'live' && provider !== 'clova'}>③ 기존 CLOVA · 무승인 서빙</option>
            </select>
            <label htmlFor="harness-mode" className="text-xs text-slate-400">실행 방식</label>
            <select id="harness-mode" value={mode} disabled={!!sessionId || pending} onChange={e => { const m = e.target.value as 'live' | 'scripted'; setMode(m); if (m === 'scripted') { setProvider('clova'); setModel('HCX-005'); } setPrompt(m === 'live' ? EXAMPLES[0].prompt : '작업장 목록을 확인해 주세요.'); }} className="min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-60">
              <option value="live">실제 API</option>
              <option value="scripted">무료 연결 확인 · 대본</option>
            </select>
            <span className="text-xs text-slate-500">{mode === 'live' ? '서버에 등록된 키 사용 · 계정의 API 한도 적용' : '작업장 목록을 확인하는 고정 응답 · 모델 검증 아님'}</span>
            <div className="ml-auto flex gap-2">
              <button className={button} disabled={!sessionId} onClick={() => void exportReport()}>기록 저장</button>
              <button className={button} disabled={busy || !sessionId} onClick={() => void reset()}>새 테스트</button>
            </div>
          </div>
          {mode === 'live' && info && <div role="status" className={`mb-3 rounded-lg border p-3 text-sm ${canRun ? 'border-slate-800 bg-slate-900/40 text-slate-400' : 'border-amber-800/60 bg-amber-950/20 text-amber-200'}`}>
            {!canRun ? `${providerInfo?.label ?? '공급자'} API 키 미등록 · 실제 API 테스트를 아직 실행할 수 없습니다.` : provider !== 'clova' ? '키 등록됨 · 실제 모델 비교 결과는 아직 없습니다. 실행 후 도구 기록과 결과 파일을 확인하세요.' : '기존 CLOVA 연결입니다. 실제 호출에는 API 사용량이 발생합니다.'}
            {provider !== 'clova' && <p className="mt-1 text-xs">이번 비교 범위: ② 도구 승인 모드. 모의 검사 통과와 실제 모델 검증은 별도로 기록합니다.</p>}
          </div>}
          {error && <div role="alert" className="mb-3 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-sm text-amber-200">{error}</div>}
          {snap?.pendingApproval && <section aria-label="도구 승인" className="mb-3 rounded-xl border border-amber-700/60 bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-200">도구 실행을 승인해 주세요 · {snap.pendingApproval.tool.replace('clova__', '')}</p>
            <pre className="my-3 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(snap.pendingApproval.input, null, 2)}</pre>
            <div className="flex gap-2"><button className={button} disabled={pending} onClick={() => void approve(true)}>실행 승인</button><button className={button} disabled={pending} onClick={() => void approve(false)}>실행 거절</button></div>
          </section>}
          {(snap?.state === 'invalid' || snap?.state === 'closed') && <div className="mb-3 rounded-lg bg-amber-950/20 p-3 text-sm text-amber-200">이 테스트는 이어갈 수 없습니다. 필요한 파일과 기록을 저장한 뒤 ‘새 테스트’를 눌러 주세요.</div>}
          <div className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
            {[
              ['입력 / 출력 토큰', `${snap?.usage.input.toLocaleString() ?? 0} / ${snap?.usage.output.toLocaleString() ?? 0}`],
              ['도구 실행', `${snap?.toolCalls ?? 0}회`],
              ['최근 응답 시간', snap?.lastTurn ? `${(snap.lastTurn.durationMs / 1000).toFixed(1)}초` : '—'],
              ['대화 요청', `${snap?.prompts ?? 0} / ${info?.maxPrompts ?? 20}`],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 font-mono text-lg text-slate-200">{value}</div></div>)}
          </div>
          <div className="grid shrink-0 grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
            <section className="flex min-h-[420px] flex-col rounded-xl border border-slate-800 bg-slate-950 xl:min-h-0">
              <div className="border-b border-slate-800 px-4 py-3 text-sm font-medium">대화와 실행 과정</div>
              <div aria-label="대화와 실행 과정" className="min-h-[180px] flex-1 space-y-2 overflow-auto p-3 xl:min-h-0">
                {!events.some(e => e.t === 'user_prompt') && <div className="px-3 py-8 text-sm leading-7 text-slate-500">아래 예제를 순서대로 실행해 보세요.<br />파일 만들기 → 내용 수정 → 되돌리기<br /><span className="text-xs">같은 테스트 안에서는 대화와 파일이 유지됩니다.</span></div>}
                {events.map(e => <EventCard key={e.cursor} event={e} />)}
                {snap?.state === 'running' && <p role="status" className="animate-pulse px-2 text-sm text-emerald-400">모델이 작업 중입니다…</p>}
                <div ref={bottom} />
              </div>
              <form onSubmit={e => { e.preventDefault(); void send(); }} className="border-t border-slate-800 p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">{EXAMPLES.map(example => <button key={example.label} type="button" disabled={busy || mode === 'scripted'} onClick={() => setPrompt(example.prompt)} className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-30">{example.label}</button>)}</div>
                <label htmlFor="harness-prompt" className="sr-only">테스트 요청</label>
                <textarea id="harness-prompt" value={prompt} maxLength={6000} onChange={e => setPrompt(e.target.value)} disabled={busy} rows={3} placeholder="모델에게 시킬 작업을 입력하세요…" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm outline-none focus:border-emerald-500 disabled:opacity-50" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">요청당 최대 {info?.maxTurns ?? 4}회 왕복 · {(info?.timeoutMs ?? 120000) / 1000}초</span>
                  {busy && sessionId ? <button className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-2 text-sm text-rose-200" type="button" onClick={() => void stop()}>중단</button> : <button type="submit" disabled={!info || !canRun || !prompt.trim() || busy || (!!snap && (snap.state !== 'idle' || snap.prompts >= snap.maxPrompts))} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">{pending ? '연결 중…' : '실행'}</button>}
                </div>
              </form>
            </section>
            <section className="flex min-h-[300px] flex-col rounded-xl border border-slate-800 bg-slate-900/30 xl:min-h-0">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><h2 className="text-sm font-medium">결과 파일</h2><span className="text-xs text-slate-500">{files.length}개</span></div>
              {files.length ? <div className="flex flex-wrap gap-2 border-b border-slate-800 p-3">{files.map(f => <button key={f.name} onClick={() => sessionId && void openFile(sessionId, f.name)} className={`rounded-md border px-2 py-1 text-xs ${selected?.name === f.name ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{f.name} · {f.bytes} B</button>)}</div> : <p className="p-5 text-sm leading-6 text-slate-500">파일을 만드는 요청을 실행하면 여기에 표시됩니다.</p>}
              {selected && <>
                <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-slate-400"><span className="truncate">{selected.name}{fileBusy ? ' · 새로 읽는 중…' : ''}</span><button className="shrink-0 text-emerald-400 hover:text-emerald-300" disabled={fileBusy} onClick={() => download(selected.name, selected.text)}>파일 내려받기</button></div>
                <pre aria-label="파일 내용" className="mx-3 mb-3 min-h-[140px] flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-sm leading-6 text-slate-300">{selected.text}</pre>
              </>}
              <div className="mt-auto border-t border-slate-800 px-4 py-3 text-[11px] leading-5 text-slate-500">{info?.idleMinutes ?? 15}분 동안 사용하지 않으면 테스트가 만료됩니다. 종료·새 테스트 전에 필요한 파일을 내려받으세요. 무료 할당량과 사용량은 각 공급자 콘솔에서 확인하세요.</div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
