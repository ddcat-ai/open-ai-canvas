#!/usr/bin/env node
// Stages prebuilt, publisher-controlled local inputs; never downloads or builds.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export async function stage(configPath) {
 const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
 if (config.exampleOnly) throw new Error('Example configuration is non-live; create a verified release configuration');
 const base = path.dirname(path.resolve(configPath));
 const resolve = value => {
  if (typeof value !== 'string' || !value) throw new Error('Missing local input path');
  return path.resolve(base, value);
 };
 if (!['windows-x64','darwin-x64','darwin-arm64','linux-x64'].includes(config.target)) {
  throw new Error('Unsupported explicit target');
 }
 if (typeof config.version !== 'string' || !config.version || !/^[a-f0-9]{40}$/.test(config.commit ?? '')) {
  throw new Error('version and full 40-character commit are required');
 }
 const output = resolve(config.output);
 try { await fs.lstat(output); throw new Error('Output already exists; refusing to overwrite'); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
 const ext = config.target.startsWith('windows-') ? '.exe' : '';
 const inputs = [
  ['runtimeExecutable', 'runtime/bin/yingce-runtime'+ext, false],
  ['backendExecutable', 'runtime/bin/yingce-backend'+ext, false],
  ['nodeDirectory', 'runtime/node', true],
  ['webDist', 'runtime/web', true],
  ['agentDirectory', 'runtime/agent', true],
  ['pluginPackages', 'plugin-packages', true],
  ['license', 'LICENSE', false],
  ['notice', 'NOTICE', false],
  ['thirdPartyNotices', 'THIRD-PARTY-NOTICES', true],
 ];
 const sources = [];
 for (const [key, dest, directory] of inputs) {
  const source = await fs.realpath(resolve(config[key]));
  const stat = await fs.stat(source);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Wrong input type: '+key);
  if (within(source, output) || within(output,source)) throw new Error('Output overlaps input: '+key);
  sources.push({source,dest,directory});
 }
 await fs.mkdir(path.dirname(output), {recursive:true});
 const temp = await fs.mkdtemp(path.join(path.dirname(output), '.runtime-stage-'));
 const records = [];
 async function copy(source, destination, boundary, ancestors = new Set()) {
  const real = await fs.realpath(source);
  if (!within(boundary,real)) throw new Error('Input symlink escapes source tree');
  const stat = await fs.stat(real);
  if (stat.isDirectory()) {
   if (ancestors.has(real)) throw new Error('Input symlink cycle');
   const next = new Set(ancestors); next.add(real);
   await fs.mkdir(destination,{recursive:true});
   for (const item of (await fs.readdir(real)).sort()) await copy(path.join(real,item),path.join(destination,item),boundary,next);
  } else if (stat.isFile()) {
   await fs.mkdir(path.dirname(destination),{recursive:true});
   await fs.copyFile(real,destination);
   await fs.chmod(destination,stat.mode & 0o777);
   const bytes = await fs.readFile(destination);
   records.push({path:path.relative(temp,destination).split(path.sep).join('/'),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  } else throw new Error('Special files are not distributable');
 }
 try {
  for (const {source,dest,directory} of sources) await copy(source,path.join(temp,dest),directory?source:path.dirname(source));
  const required = [
   'runtime/web/index.html', 'runtime/node/node'+ext,
   'runtime/agent/agent-runtime.mjs','runtime/agent/package.json',
  ];
  for (const name of required) if (!(await fs.stat(path.join(temp,name))).isFile()) throw new Error('Missing required staged file: '+name);
  if (!(await fs.stat(path.join(temp,'runtime/agent/node_modules'))).isDirectory()) throw new Error('Missing production Agent dependencies');
  const pkg = JSON.parse(await fs.readFile(path.join(temp,'runtime/agent/package.json'),'utf8'));
  if (!pkg.engines?.node) throw new Error('Agent Node engine requirement missing');
  await fs.writeFile(path.join(temp,'runtime-package.json'),JSON.stringify({
   schemaVersion:1,version:config.version,commit:config.commit,target:config.target,
   nodeVersion:config.nodeVersion ?? 'UNVERIFIED',agentNodeEngine:pkg.engines.node,
   verification:'local-staging-only-not-a-signed-release-manifest',
   files:records.sort((a,b)=>a.path.localeCompare(b.path)),
  },null,2)+'\n');
  // Same-parent rename publishes the complete tree; never merge with an existing release.
  try { await fs.lstat(output); throw new Error('Output appeared during staging'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(temp,output);
  return output;
 } catch (error) {
  await fs.rm(temp,{recursive:true,force:true});
  throw error;
 }
}
function within(root, candidate) {
 const rel = path.relative(root,candidate);
 return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..'+path.sep));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 if (process.argv.length !== 3) {
  console.error('Usage: node stage-runtime.mjs LOCAL-CONFIG.json'); process.exitCode=2;
 } else {
  stage(process.argv[2]).then(out=>console.log('Staged unsigned runtime package: '+out)).catch(err=>{console.error(err.message);process.exitCode=1;});
 }
}
