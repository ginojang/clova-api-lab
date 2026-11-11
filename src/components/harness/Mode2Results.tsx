import { useEffect, useState } from 'react';

type Report = {
  createdAt: string;
  results: { provider: string; model: string; mock: { status: string; stepsPassed: number; approvals: number }; live: { status: string } }[];
};

export default function Mode2Results() {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}mode2-comparison-report.json`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (active && value?.results) setReport(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!report) return null;
  return <details className="mb-3 rounded-xl border border-slate-800 bg-slate-900/60">
    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-200">새 API ② 연결 검사 기록 · 모의 API</summary>
    <div className="px-4 pb-4">
      <p className="mb-3 text-xs leading-5 text-slate-400">실제 Elda-CLI → 자체 하네스 → MCP 파일 도구를 모의 API로 검사한 기록입니다. 모델의 지시 준수·품질은 아직 검증하지 않았습니다. {new Date(report.createdAt).toLocaleString('ko-KR')}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead className="text-slate-500"><tr>{['공급자 / 모델', '파일 과제', '도구 승인', '실제 API 검사'].map(label => <th key={label} className="px-2 py-2 font-normal">{label}</th>)}</tr></thead>
        <tbody>{report.results.map(result => <tr key={result.provider} className="border-t border-slate-800 text-slate-300">
          <td className="break-all px-2 py-2">{result.model}</td>
          <td className="whitespace-nowrap px-2 py-2">{result.mock.stepsPassed}/3 · {result.mock.status === 'mock_passed' ? '모의 통과' : '확인 필요'}</td>
          <td className="px-2 py-2">{result.mock.approvals}회</td>
          <td className="whitespace-nowrap px-2 py-2 text-amber-300">{result.live.status === 'live_passed' ? '통과' : result.live.status === 'not_configured' ? '미실시 · 키 없음' : '확인 필요'}</td>
        </tr>)}</tbody>
      </table></div>
      <a href={`${import.meta.env.BASE_URL}mode2-comparison-report.json`} download className="mt-3 inline-block text-xs text-emerald-400 hover:underline">② 검사 결과 JSON 내려받기</a>
    </div>
  </details>;
}
