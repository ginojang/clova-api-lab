import {writeFileSync, existsSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Brain} from './provider.ts';
import {Fault} from './common.ts';

const {values} = parseArgs({options: {live: {type: 'boolean'}, output: {type: 'string'}}});
if (!values.live || !values.output || existsSync(values.output)) throw new Error('Use --live --output NEW_FILE');
const report: any = {scope: 'provider success-path smoke, not H31 or persona evaluation', startedAt: new Date().toISOString(),
  sourceHashes: Object.fromEntries(['provider.ts','provider-errors.ts','common.ts'].map(name => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')])), results: []};
for (const model of ['clova:HCX-005', 'clova:HCX-007']) {
  const start = Date.now();
  try {
    const answer = await new Brain(model).call([{role:'user',content:'연결 확인입니다. 확인했습니다 한 문장으로 답해 주세요.'}], [], AbortSignal.timeout(60000), {maxTokens:128});
    report.results.push({model, ok: Boolean(answer.message.content.trim()) && answer.finishReason === 'stop', ...answer, durationMs:Date.now()-start});
  } catch (e) {
    report.results.push({model,ok:false,error:e instanceof Fault ? e.code : 'unknown', apiError:e instanceof Fault ? e.apiError : undefined,durationMs:Date.now()-start});
  }
}
report.pass=report.results.every((r:any)=>r.ok);
report.finishedAt=new Date().toISOString();
writeFileSync(values.output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({pass:report.pass,attempts:report.results.length}));
if (!report.pass) process.exitCode=1;
