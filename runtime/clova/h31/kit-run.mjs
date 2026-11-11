// Execute the official unmodified kit with local-only deterministic model transport.
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../../..');
const kit='/home/gino/WorkArea/Elda-Spec/harness/kit/check.ts';
const index=process.argv.indexOf('--output');
const output=index>=0?resolve(process.argv[index+1]):undefined;
if(!output||existsSync(output))throw Error('Specify new --output report.json');
mkdirSync(join(root,'.local/h31-kit'),{recursive:true});
const folder=mkdtempSync(join(root,'.local/h31-kit/run-'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={kind:'official kit with deterministic local native transport',at:new Date().toISOString(),externalModelCalls:0,
 kitPath:kit,kitSha256:hash(kit),specCommit:execFileSync('git',['-C','/home/gino/WorkArea/Elda-Spec','rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 driverSha256:hash(join(root,'runtime/clova/h31/kit-driver.mjs')),nativeLoaderSha256:hash(join(root,'runtime/clova/h31/kit-native.py')),
 results:[],workDirectory:folder};
await Promise.all(['elda','langgraph','pi'].map(async harness=>{
 const dir=join(folder,harness);mkdirSync(dir);const tmp=join(dir,'tmp'),traces=join(dir,'traces');mkdirSync(tmp);mkdirSync(traces);
 const conf={name:`clova-lab-${harness}`,spec:'0.805',command:[process.execPath,join(root,'runtime/clova/h31/kit-driver.mjs'),'--harness',harness,'--workspace','{workspace}'],env:{H31_KIT_MAX_TURNS:'6',H31_KIT_BATCH:'0',KIT_TRACE_ROOT:traces},brain:'clova:HCX-005',prompt:'파일 작업을 수행하고 결과를 확인해 주세요.',maxTurnsEnv:'H31_KIT_MAX_TURNS',turnTimeoutMs:15000,approvalArgs:['--approve','ask'],multiCallEnv:{H31_KIT_BATCH:'1'}};
 const confPath=join(dir,'config.json'),jsonPath=join(dir,'official.json');writeFileSync(confPath,JSON.stringify(conf,null,2)+'\n');
 const proc=spawn(process.execPath,[kit,confPath,'--json',jsonPath],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:tmp,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 let log='',stderr='';proc.stdout.on('data',c=>log+=c);proc.stderr.on('data',c=>stderr+=c);
 const exit=await new Promise(r=>proc.once('close',r));
 const sessions=readdirSync(traces).map(name=>{const d=join(traces,name);return {name,report:existsSync(join(d,'report.json'))?JSON.parse(readFileSync(join(d,'report.json'),'utf8')):null,stdout:existsSync(join(d,'stdout.jsonl'))?readFileSync(join(d,'stdout.jsonl'),'utf8'):'',stdin:existsSync(join(d,'stdin.jsonl'))?readFileSync(join(d,'stdin.jsonl'),'utf8'):'',stderr:existsSync(join(d,'stderr.txt'))?readFileSync(join(d,'stderr.txt'),'utf8'):''};});
 const item={harness,exit,config:conf,official:existsSync(jsonPath)?JSON.parse(readFileSync(jsonPath,'utf8')):null,log,stderr,sessions};report.results.push(item);
 console.log(JSON.stringify({harness,exit,fail:item.official?.fail,warn:item.official?.warn,skips:item.official?.findings.filter(x=>x.level==='SKIP').length}));
}));
report.results.sort((a,b)=>['elda','langgraph','pi'].indexOf(a.harness)-['elda','langgraph','pi'].indexOf(b.harness));
report.kitUnchanged=hash(kit)===report.kitSha256;
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
if(report.results.some(x=>x.exit!==0))process.exitCode=1;
