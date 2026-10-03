import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const zeroCost = { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 };
function nativeHistory() {
  const manager = SessionManager.inMemory('/isolated-test');
  for (let i=0; i<14; i++) {
    manager.appendMessage({role:'user',content:`商品事实-${i}：目标德国市场，禁止引入竞品品牌。${'素材角色已确认。'.repeat(900)}`,timestamp:Date.now()-100000+i*2});
    manager.appendMessage({role:'assistant',content:[{type:'text',text:`确认-${i}`}],api:'openai-completions',provider:'infinite-canvas',model:'local-fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:zeroCost},stopReason:'stop',timestamp:Date.now()-100000+i*2+1});
  }
  return [manager.getHeader(),...manager.getEntries()].map(JSON.stringify).join('\n')+'\n';
}
async function fixture(t, overrides={}) {
  const events=[], calls=[];
  const server=createServer(async(req,res)=>{
    const chunks=[]; for await(const chunk of req) chunks.push(chunk); const raw=Buffer.concat(chunks).toString('utf8');
    const body=JSON.parse(raw); res.setHeader('content-type','application/json');
    if(req.url==='/event') {events.push(body);res.end('{}');return;}
    if(req.url==='/model') {
      calls.push(body);
      const compaction=body.purpose==='compaction';
      res.end(JSON.stringify({text:compaction?'商品事实：保留原商品；德国站德语卖点；中文仅审核；产品/竞品角色不混淆；已完成任务保留，未完成任务继续。':'已完成本轮对话。',usage:{input:2000,output:40,cacheRead:0,cacheWrite:0,totalTokens:2040}}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function run(extra={}) {
    const request={bridgeURL:`http://127.0.0.1:${server.address().port}`,bridgeToken:'isolated-test',runId:'test-run',turnId:'test-run',prompt:'请继续，保留商品事实和目标市场。',systemPrompt:'根据确认的产品事实执行；此处不是摘要提示。',model:{id:'local-fixture',contextWindow:16384,maxTokens:2048},tools:[],compaction:{enabled:true,reserveTokens:4096,keepRecentTokens:2048},...overrides,...extra};
    const child=spawn(process.execPath,['agent-runtime.mjs'],{cwd:import.meta.dirname,stdio:['pipe','pipe','pipe']});
    let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.stdin.end(JSON.stringify(request));
    const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
    const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
    assert.equal(code,0,`${out}\n${err}`);
    return out;
  }
  return {events,calls,run};
}

test('real Pi compacts >10 turns and >64KB, persists native result and resumes without resurrecting history',async(t)=>{
  const history=nativeHistory();assert.ok(Buffer.byteLength(history)>65536);
  const {events,calls,run}=await fixture(t);
  await run({sessionJSONL:history});
  assert.ok(calls.some(x=>x.purpose==='compaction'),'native summarizer must use isolated compaction bridge purpose');
  const summary=calls.find(x=>x.purpose==='compaction');
  assert.ok(summary.systemPrompt && summary.systemPrompt!=='根据确认的产品事实执行；此处不是摘要提示。');
  const completed=events.find(x=>x.type==='compaction_end'&&x.result);
  assert.ok(completed?.sessionJSONL,'success event must carry its native snapshot');
  assert.ok(!completed.sessionJSONL.includes('�'),'UTF-8 must survive multi-chunk snapshots');
  const entries=completed.sessionJSONL.trim().split('\n').map(JSON.parse);
  assert.ok(entries.some(e=>e.type==='compaction'));
  assert.ok(entries.filter(e=>e.type==='message'&&e.message.role==='user').length>=14,'journal must retain original turns');
  const snapshot=events.filter(x=>x.type==='session_snapshot').at(-1).sessionJSONL;
  const previousCalls=calls.length;
  await run({sessionJSONL:snapshot,runId:'test-run-2',turnId:'test-run-2',prompt:'新一轮，只做文本解释。'});
  const next=calls.slice(previousCalls).find(x=>x.purpose==='dialogue');
  assert.ok(next);
  assert.ok(next.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('商品事实：保留原商品')),'native summary must reach the Go model bridge as an ordinary user message');
  assert.ok(JSON.stringify(next.messages).length<Buffer.byteLength(history)/2,'compacted context must stay compact on continuation');
  const restored=events.filter(x=>x.type==='session_snapshot').at(-1).sessionJSONL.trim().split('\n').map(JSON.parse);
  const occurrences=restored.filter(e=>e.type==='message'&&e.message.role==='user'&&JSON.stringify(e.message.content).includes('新一轮，只做文本解释。'));
  assert.equal(occurrences.length,1);
});

test('native compaction checkpoint replays same model identity and does not lose or duplicate the current prompt', async(t)=>{
  const {events,calls,run}=await fixture(t);
  await run({sessionJSONL:nativeHistory()});
  const firstSummary=calls.find(x=>x.purpose==='compaction');
  assert.ok(firstSummary);
  const checkpoint=events.find(e=>e.type==='session_snapshot'&&e.sessionJSONL.includes(`"stepId":"${firstSummary.stepId}"`));
  assert.ok(checkpoint);
  const before=calls.length;
  await run({sessionJSONL:checkpoint.sessionJSONL,resumeFromCheckpoint:true});
  const resumed=calls.slice(before);
  assert.equal(resumed[0].purpose,'compaction');
  assert.equal(resumed[0].stepId,firstSummary.stepId);
  assert.equal(resumed[0].systemPrompt,firstSummary.systemPrompt);
  const stable=messages=>messages.map(({timestamp,...message})=>message);
  assert.deepEqual(stable(resumed[0].messages),stable(firstSummary.messages));
  assert.equal(resumed.filter(x=>x.purpose==='dialogue').length,1);
  const final=events.filter(e=>e.type==='session_snapshot').at(-1).sessionJSONL.trim().split('\n').map(JSON.parse);
  assert.equal(final.filter(e=>e.type==='message'&&e.message.role==='user'&&JSON.stringify(e.message.content).includes('请继续，保留商品事实和目标市场。')).length,1);
});


test('server turn facts reach the model bridge in a supported LLM message role',async(t)=>{
 const {calls,run}=await fixture(t);
 await run({turnContext:'服务端锁定事实：COMMERCE_FACT_LOCK'});
 const call=calls.find(x=>x.purpose==='dialogue');
 assert.ok(call?.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('COMMERCE_FACT_LOCK')),'custom turn facts must be converted to an LLM user message, not silently dropped by Go');
});
