#!/usr/bin/env node
/** Render recorded evidence without making model calls or assigning semantic scores. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inside} from '../clova/common.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const input=inside(root,relative(root,resolve(option('--input','runtime/memory-lab/results/live-no-tools-2026-11-10.json'))));
const output=inside(root,relative(root,resolve(option('--output','runtime/memory-lab/results/live-transcript.md'))));
const data=JSON.parse(readFileSync(input,'utf8'));
const review=data.experiment==='followup'?'[Pi 리뷰](followup-pi-review.md) · [Agno 리뷰](followup-agno-review.md)':'[별도 리뷰](live-review.md)';
const lines=['# 실제 HCX-005 페르소나 평가 응답 원문','',`모델: **${data.model}**. 실행: ${data.startedAt} → ${data.finishedAt??'진행 중'}.`,`실제 API 호출 ${data.externalModelCalls}회; 입력 ${data.usage.input} / 출력 ${data.usage.output} 토큰.`,`원본: [실행 JSON](${relative(dirname(output),input)}). 자동 페르소나 교정 없이 받은 첫 응답이다.`,`아래 API 완료는 성격 평가 통과를 뜻하지 않는다. 의미 평가는 ${review}에 있다.`, '', '## 실행별 요약','', '| 하네스 | 페르소나 | 조건 | 완료 응답 | API 완료 |', '|---|---|---|---:|---|'];
for(const g of data.groups)lines.push(`| ${g.framework} ${g.version??''} | ${g.persona} | ${g.variant??'baseline'} | ${g.steps.length} | ${g.steps.filter(s=>s.operationalSuccess).length}/${g.steps.length}${g.completed?'':' (진행 미완료)'} |`);
if(data.resumedFrom)lines.push('',`재개 기록: 이전 ${data.resumedFrom.priorRequests}회와 이번 ${data.newRequests??'진행 중'}회를 합산했다. 기존 실패를 재호출하지 않았다. HTTP 실패의 토큰 사용량은 알 수 없어 위 합계는 API가 보고한 사용량만 포함한다.`,'');
for(const g of data.groups){
  lines.push('',`## ${g.framework} / ${g.persona} / ${g.variant??'baseline'}`,'',`페르소나 SHA-256: \`${g.personaHash}\``,'');
  for(const s of g.steps){
    lines.push(`### ${s.id}`,'',`프로세스 ${s.process} · 모델 ${s.requests}회 · 입력 ${s.usage.input} / 출력 ${s.usage.output} 토큰 · ${s.durationMs}ms · 교정 ${s.correctionAttempts}회`,'','사용자 입력:','');
    if(s.prompt.length>800)lines.push('긴 참고 자료를 포함한 입력 원문은 실행 JSON에 보존했다. 마지막 요청:','',`> ${s.prompt.split('\n').at(-1)}`);
    else lines.push(...s.prompt.split('\n').map(l=>'> '+l));
    if(s.providerEvidenceValid===false)lines.push('','평가 가능한 모델 텍스트 응답 없음. API/하네스 실패이며 성격 실패 점수로 처리하지 않는다.','');
    else lines.push('','실제 모델 응답:','',...s.response.split('\n').map(l=>'> '+l),'');
    if(s.errors.length)lines.push(`실행 오류: ${JSON.stringify(s.errors)}`,'');
  }
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,lines.join('\n')+'\n');
process.stdout.write(`Rendered ${relative(root,output)}\n`);
