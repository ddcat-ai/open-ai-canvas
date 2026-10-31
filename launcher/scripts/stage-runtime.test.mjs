import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stage } from './stage-runtime.mjs';

async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'yingce-package-test-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const inputs = path.join(root,'inputs');
 async function write(name,content='fixture-only-not-executable') {
  const p = path.join(inputs,name);
  await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,content);return p;
 }
 const config = {
  version:'test-only',commit:'a'.repeat(40),target:'linux-x64',nodeVersion:'test-only',
  output:path.join(root,'output'),
  runtimeExecutable:await write('runtime'),
  backendExecutable:await write('backend'),
  nodeDirectory:path.dirname(await write('node/node')),
  webDist:path.dirname(await write('web/index.html','<html>test</html>')),
  agentDirectory:path.dirname(await write('agent/agent-runtime.mjs')),
  pluginPackages:path.dirname(await write('plugins/README','test-only')),
  license:await write('LICENSE'),notice:await write('NOTICE'),
  thirdPartyNotices:path.dirname(await write('notices/README')),
 };
 await write('agent/package.json',JSON.stringify({engines:{node:'>=22.19.0'}}));
 await write('agent/node_modules/fixture/package.json','{}');
 const configPath=path.join(root,'config.json');
 await fs.writeFile(configPath,JSON.stringify(config));
 return {root,inputs,config,configPath};
}
test('example configuration cannot stage',async()=>{
 await assert.rejects(stage(new URL('./runtime-package.example.json',import.meta.url)),/Example configuration is non-live/);
});
test('stage complete local layout and refuse overwrite',async t=>{
 const {config,configPath}=await fixture(t);
 assert.equal(await stage(configPath),config.output);
 const inventory=JSON.parse(await fs.readFile(path.join(config.output,'runtime-package.json'),'utf8'));
 assert.equal(inventory.target,'linux-x64');
 assert.equal(inventory.verification,'local-staging-only-not-a-signed-release-manifest');
 const runtime=inventory.files.find(f=>f.path==='runtime/bin/yingce-runtime');
 assert.match(runtime.sha256,/^[0-9a-f]{64}$/);
 assert.equal(await fs.readFile(path.join(config.output,'runtime/web/index.html'),'utf8'),'<html>test</html>');
 await assert.rejects(stage(configPath),/Output already exists/);
});
test('reject out-of-tree input links and remove partial staging',async t=>{
 const {root,config,configPath}=await fixture(t);
 const secret=path.join(root,'outside.txt');await fs.writeFile(secret,'not distributable');
 try {await fs.symlink(secret,path.join(config.webDist,'escape.txt'));}
 catch(error) {t.skip('symlinks unavailable: '+error.code);return;}
 await assert.rejects(stage(configPath),/symlink escapes/);
 await assert.rejects(fs.stat(config.output),{code:'ENOENT'});
 assert.equal((await fs.readdir(root)).filter(n=>n.startsWith('.runtime-stage-')).length,0);
});
