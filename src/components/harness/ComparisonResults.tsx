import {useEffect,useState} from 'react';

type Result={mode:string;harness:string;pass:boolean;durationMs:number;modelCalls:number;toolCalls:number;approvals:number;usage:{input:number;output:number};steps:{id:string;pass:boolean}[]};
type Report={createdAt:string;inference:'live'|'mock';pass:boolean;task:{model:string;maxTokens:number};results:Result[];integration?:{mode1Attach?:{pass:boolean};eldaModes?:{pass:boolean}}};
const modes:Record<string,string>={'1':'① Claude Code','2':'② 자체 · 승인','3':'③ 자체 · 서빙'};
export default function ComparisonResults() {
  const [report,setReport]=useState<Report|null>(null);
  useEffect(()=>{let active=true;fetch(`${import.meta.env.BASE_URL}comparison-report.json`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(r=>{if(active&&r?.results)setReport(r);}).catch(()=>{});return()=>{active=false;};},[]);
  if(!report)return null;
  return <details className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60">
    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-200">기존 CLOVA 3모드 검증 기록 · {report.inference==='live'?'실제 API':'모의 API'} · {report.pass?'통과':'실패 항목 있음'}</summary>
    <div className="px-4 pb-4">
      <p className="mb-3 text-xs leading-5 text-slate-400">같은 {report.task.model} · 파일 생성 → 수정 → 되돌리기 · 출력 최대 {report.task.maxTokens.toLocaleString()}토큰 · {new Date(report.createdAt).toLocaleString('ko-KR')}</p>
      <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="text-slate-500"><tr>{['하네스','과제','모델 / 도구','입력 / 출력 토큰','전체 시간'].map(h=><th key={h} className="px-2 py-2 font-normal">{h}</th>)}</tr></thead>
        <tbody>{report.results.map(r=><tr key={r.mode} className="border-t border-slate-800 text-slate-300"><td className="px-2 py-2">{modes[r.mode]}<span className="ml-2 text-slate-500">{r.mode!=='1'?'LangGraph':''}</span></td><td className={`px-2 py-2 ${r.pass?'text-emerald-400':'text-amber-300'}`}>{r.steps.filter(s=>s.pass).length}/3 {r.pass?'통과':'확인 필요'}</td><td className="px-2 py-2">{r.modelCalls} / {r.toolCalls}회</td><td className="px-2 py-2">{r.usage.input.toLocaleString()} / {r.usage.output.toLocaleString()}</td><td className="px-2 py-2">{(r.durationMs/1000).toFixed(1)}초</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs leading-5 text-slate-500">로컬에서 실행한 한 과제의 기능 검증입니다. ①은 실제 Claude Code의 비대화형 세션으로 검증했습니다. 아래에서는 ②·③을 직접 실행할 수 있습니다. 시간에는 도구 실행이 포함되며, 반복 측정한 성능 순위는 아닙니다.</p>
      {report.integration?.mode1Attach?.pass && <p className="mt-2 text-xs text-emerald-400">Elda-CLI ① 대화형 attach → CLOVA 실제 API도 3턴 통과{report.integration.eldaModes?.pass ? ' · ②·③ Elda 어댑터 경로도 실제 API 통과' : ''}</p>}
      <a className="mt-2 inline-block text-xs text-emerald-400 hover:underline" href={`${import.meta.env.BASE_URL}comparison-report.json`} download>비교 결과 JSON 내려받기</a>
    </div>
  </details>;
}
