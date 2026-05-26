import { useClovaStore } from '../store/useClovaStore';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-slate-500 focus:outline-none';

export default function ParamPanel() {
  const { model, systemPrompt, temperature, topP, maxTokens, set } = useClovaStore();

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        파라미터
      </h2>

      <Field label="Model">
        <input
          className={inputCls}
          value={model}
          onChange={(e) => set('model', e.target.value)}
        />
      </Field>

      <Field label={`Temperature · ${temperature}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={temperature}
          onChange={(e) => set('temperature', Number(e.target.value))}
          className="w-full"
        />
      </Field>

      <Field label={`Top P · ${topP}`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={topP}
          onChange={(e) => set('topP', Number(e.target.value))}
          className="w-full"
        />
      </Field>

      <Field label="Max Tokens">
        <input
          type="number"
          className={inputCls}
          value={maxTokens}
          onChange={(e) => set('maxTokens', Number(e.target.value))}
        />
      </Field>

      <Field label="System Prompt">
        <textarea
          className={`${inputCls} h-24 resize-none`}
          value={systemPrompt}
          onChange={(e) => set('systemPrompt', e.target.value)}
        />
      </Field>
    </div>
  );
}
