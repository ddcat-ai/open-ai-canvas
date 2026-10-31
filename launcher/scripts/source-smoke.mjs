#!/usr/bin/env node
// Optional integration smoke against a real, source-built runtime release.
// node launcher/scripts/source-smoke.mjs --runtime <absolute runtime/bin/yingce-runtime[.exe]> [--port 33123] [--data-parent <absolute path>]
// Creates a fresh data directory; never opens or removes an existing user database.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--runtime', '--port', '--data-parent', '--timeout-seconds'].includes(key) ||
      options[key] !== undefined || !process.argv[i + 1]) {
    throw new Error('Usage: source-smoke.mjs --runtime <absolute executable> [--port <1..65535>] [--data-parent <absolute directory>] [--timeout-seconds <1..600>]');
  }
  options[key] = process.argv[i + 1];
}
const executable = options['--runtime'];
if (!executable || !path.isAbsolute(executable)) throw new Error('--runtime must be an absolute executable path');
if (!(await fs.stat(executable)).isFile()) throw new Error('--runtime is not a file');
const requestedPort = options['--port'] === undefined ? 0 : Number(options['--port']);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535 ||
    (options['--port'] !== undefined && requestedPort === 0)) throw new Error('Invalid --port');
const timeoutSeconds = Number(options['--timeout-seconds'] ?? 120);
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) throw new Error('Invalid --timeout-seconds');
const parent = options['--data-parent'] ?? fileURLToPath(new URL('../../.local/source-smoke/', import.meta.url));
if (!path.isAbsolute(parent)) throw new Error('--data-parent must be absolute');

// Check the requested port before spawning. The runtime must bind this exact port;
// it fails rather than switching ports if another process wins the bind race.
const reservation = net.createServer();
await new Promise((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen({ host: '127.0.0.1', port: requestedPort }, resolve);
});
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
await fs.mkdir(parent, { recursive: true });
const data = await fs.mkdtemp(path.join(parent, 'run-'));
const token = randomBytes(32).toString('hex');
const base = 'http://127.0.0.1:' + port;
console.log('Source smoke data (retained for inspection): ' + data);
let child, exited, finished, exitInfo;
let tail = '', cookie = '';
function launchRuntime() {
  finished = false; exitInfo = undefined;
  child = spawn(executable, ['--port', String(port), '--data-dir', data], {
    env: { ...process.env, YINGCE_RUNTIME_SHUTDOWN_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { tail = (tail + chunk.toString()).slice(-16000); });
  exited = new Promise(resolve => {
    child.once('error', error => { finished = true; exitInfo = { error }; resolve(exitInfo); });
    child.once('exit', (code, signal) => { finished = true; exitInfo = { code, signal }; resolve(exitInfo); });
  });
}
launchRuntime();
let interrupted = false;
const onInterrupt = () => { interrupted = true; };
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
async function request(route, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Origin', base);
  if (cookie) headers.set('Cookie', cookie);
  return fetch(base + route, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
}
async function envelope(route, init = {}) {
  const response = await request(route, init);
  if (!response.ok) throw new Error(route + ': HTTP ' + response.status);
  const value = await response.json();
  if (value.code !== 0) throw new Error(route + ': business code ' + value.code);
  return value.data;
}
async function waitForExit(ms) {
  return Promise.race([exited.then(() => true), sleep(ms, false, { ref: false })]);
}
async function stopOwned() {
  if (finished) throw new Error('Owned runtime exited before the private stop request: ' + JSON.stringify(exitInfo));
  try {
    const response = await request('/_launcher/stop', {
      method: 'POST', headers: { 'X-Yingce-Runtime-Token': token },
    });
    if (response.status !== 202) throw new Error('Private stop returned HTTP ' + response.status);
    await response.arrayBuffer();
  } catch (error) {
    // Only signal the exact child we spawned, never kill a process by port/name.
    if (!finished) child.kill('SIGTERM');
    if (!(await waitForExit(60000))) throw new Error('Owned runtime did not exit after stop: ' + error.message);
    throw error;
  }
  if (!(await waitForExit(60000))) {
    if (!finished) child.kill('SIGTERM');
    if (!(await waitForExit(60000))) {
      if (!finished) child.kill('SIGKILL');
      await exited;
    }
    throw new Error('Owned runtime exceeded its shutdown deadline');
  }
  if (exitInfo.error || exitInfo.code !== 0) throw new Error('Runtime shutdown was not clean: ' + JSON.stringify(exitInfo));
}

let failure;
try {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError;
  let ready = false;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('Source smoke interrupted');
    if (finished) throw new Error('Runtime exited before readiness: ' + JSON.stringify(exitInfo));
    try {
      const status = await envelope('/api/health/ready');
      if (status.ready !== true) throw new Error('Readiness payload is not ready');
      ready = true;
      break;
    } catch (error) { lastError = error; }
    await sleep(300);
  }
  if (!ready) throw new Error('Readiness timed out: ' + lastError?.message);
  const page = await request('/');
  const html = await page.text();
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Frontend index unavailable');
  const script = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1];
  if (!script) throw new Error('Built frontend has no script asset');
  const scriptURL = new URL(script, base);
  if (scriptURL.origin !== base) throw new Error('Frontend script is not local');
  const asset = await request(scriptURL.pathname + scriptURL.search);
  if (!asset.ok || !/javascript/.test(asset.headers.get('content-type') ?? '')) throw new Error('Built JS asset unavailable');
  await asset.arrayBuffer();
  const settings = await envelope('/api/auth/settings');
  if (!settings || typeof settings !== 'object') throw new Error('Public auth settings unavailable');
  const session = await envelope('/api/auth/session');
  if (session.user !== null) throw new Error('Fresh smoke data unexpectedly has a logged-in user');
  const missing = await request('/assets/source-smoke-definitely-missing.js');
  if (missing.status !== 404) throw new Error('Missing JS was not a 404');
  await missing.arrayBuffer();
  const forbidden = await request('/_launcher/stop', { method: 'POST' });
  if (forbidden.status !== 403) throw new Error('Unauthenticated management request was not rejected');
  await forbidden.arrayBuffer();
  await envelope('/api/health/ready');
  console.log('PASS: real backend ready, built SPA/JS, auth settings/session, missing assets, private stop authentication');
  // This is an isolated local test administrator, never a real cloud account.
  const username = 'launcher-smoke';
  const password = randomBytes(24).toString('base64url');
  const registration = await request('/api/auth/register', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,acceptedTerms:true})});
  const registrationBody = await registration.json();
  if(!registration.ok || registrationBody.code!==0 || !registrationBody.data?.user?.id) throw Error('Local first-administrator registration failed');
  cookie = registration.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  if(!cookie) throw Error('Local session cookie was not set');
  const login = await request('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  const loginBody = await login.json();
  if(!login.ok || loginBody.code!==0) throw Error('Local login failed');
  cookie = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ') || cookie;
  const created = await envelope('/api/projects', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Launcher persistence smoke',type:'short-drama',sourceType:'blank'})});
  if(!created.project?.id) throw Error('Project was not created');
  await stopOwned();
  launchRuntime();
  let restarted=false;
  for(let i=0;i<200;i++){
    if(finished) throw Error('Restarted runtime exited before readiness');
    try{if((await envelope('/api/health/ready')).ready){restarted=true;break}}catch{}
    await sleep(300);
  }
  if(!restarted) throw Error('Restarted backend not ready');
  const restoredSession = await envelope('/api/auth/session');
  if(restoredSession.user?.id!==registrationBody.data.user.id) throw Error('Session did not persist after restart');
  const restored = await envelope('/api/projects/'+encodeURIComponent(created.project.id));
  if(restored.project?.id!==created.project.id || restored.project.name!=='Launcher persistence smoke') throw Error('Project did not persist after restart');
  console.log('PASS: local first-administrator registration/login, project creation, authenticated session and project persistence after clean restart');
} catch (error) {
  failure = error;
} finally {
  try { await stopOwned(); } catch (error) { failure ??= error; }
  if (interrupted) failure ??= new Error('Source smoke interrupted');
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onInterrupt);
}
if (failure) {
  // Never print the management credential even if a child unexpectedly echoes it.
  console.error(tail.split(token).join('[redacted]'));
  throw failure;
}
console.log('PASS: owned runtime stopped cleanly; data retained at ' + data);
