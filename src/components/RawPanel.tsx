import { useClovaStore } from '../store/useClovaStore';

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text = value == null ? '—' : JSON.stringify(value, null, 2);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </span>
        <button
          onClick={() => navigator.clipboard?.writeText(text)}
          className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800"
        >
          Copy
        </button>
      </div>
      <pre className="max-h-60 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-300">
        {text}
      </pre>
    </div>
  );
}

export default function RawPanel() {
  const { lastRequest, lastResponse } = useClovaStore();

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Raw / Log
      </h2>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">Latency</span>
        <span className="font-mono text-slate-200">
          {lastResponse ? `${lastResponse.latencyMs} ms` : '—'}
        </span>
        {lastResponse && (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${
              lastResponse.ok
                ? 'bg-emerald-900/60 text-emerald-300'
                : 'bg-red-900/60 text-red-300'
            }`}
          >
            {lastResponse.ok ? 'OK' : 'ERROR'}
          </span>
        )}
      </div>

      <JsonBlock title="Raw Request" value={lastRequest} />
      <JsonBlock title="Raw Response" value={lastResponse?.raw} />
    </div>
  );
}
