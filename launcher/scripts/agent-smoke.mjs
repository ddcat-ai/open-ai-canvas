// Exercises the packaged Node + real Agent SDK with a local protocol fixture,
// not a cloud model or the product backend's authorization/accounting routes.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
const release = process.argv[2];
if (!release || !path.isAbsolute(release)) throw Error("absolute release path required");
const tmp = await fs.mkdtemp(path.join(path.resolve(".local"), "agent-smoke-"));
const token = randomBytes(32).toString("hex");
let modelCalls = 0, snapshots = 0;
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + token) { res.writeHead(403).end(); return; }
  let raw=""; for await (const chunk of req) { raw+=chunk; if(raw.length>8*1024*1024){res.writeHead(413).end();return;} }
  const body=JSON.parse(raw||"{}");
  res.setHeader("Content-Type","application/json");
  if(req.url === "/model"){ modelCalls++; res.end(JSON.stringify({text:"Agent SDK smoke completed",toolCalls:[],usage:{input:1,output:1,total:2}})); }
  else if(req.url === "/event"){ if(body.type==="session_snapshot") snapshots++; res.end("{}"); }
  else res.writeHead(404).end("{}");
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const node=path.join(release,"runtime/node",process.platform==="win32"?"node.exe":"node");
const child=spawn(node,[path.join(release,"runtime/agent/agent-runtime.mjs")],{cwd:release,env:{
  PATH:path.join(release,"runtime/node"),NODE_ENV:"production",PI_OFFLINE:"1",
  SystemRoot:process.env.SystemRoot||"",WINDIR:process.env.WINDIR||"",
  TEMP:tmp,TMP:tmp,TMPDIR:tmp,HOME:tmp,USERPROFILE:tmp,
},windowsHide:true,stdio:["pipe","pipe","pipe"]});
let stdout="",stderr=""; child.stdout.on("data",b=>stdout=(stdout+b).slice(-64000));child.stderr.on("data",b=>stderr=(stderr+b).slice(-64000));
child.stdin.end(JSON.stringify({bridgeURL:"http://127.0.0.1:"+server.address().port,bridgeToken:token,prompt:"Complete the runtime smoke.",systemPrompt:"You are a test assistant.",tools:[],model:{id:"local-fixture",contextWindow:8192,maxTokens:128}}));
const timeout=setTimeout(()=>child.kill(),60000);
try {
  const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve)});
  if(code!==0||modelCalls<1||snapshots<1||!stdout.includes('"settled"')) throw Error("Agent SDK fixture failed: "+stdout+" "+stderr);
  console.log("PASS: packaged Node, real Agent SDK imports/session/model bridge/snapshots/settled; cloud generation not tested");
} finally {clearTimeout(timeout);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});}
