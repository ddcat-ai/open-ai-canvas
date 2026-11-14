'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const http = require('node:http');
const { terminateChild, ServiceRestarter, waitForService } = require('../src/service-lifecycle');

test('health probe waits for a slow startup and detects early process exit', async (t) => {
  const server = http.createServer((req, res) => res.end('ready'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  let ready = false;
  server.removeAllListeners('request');
  server.on('request', (req, res) => { res.statusCode = ready ? 200 : 503; res.end(); });
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null });
  const url = `http://127.0.0.1:${server.address().port}`;
  const pending = waitForService({ url, child, timeoutMs: 2000 });
  setTimeout(() => { ready = true; }, 100);
  await pending;

  ready = false;
  const failed = waitForService({ url, child, timeoutMs: 2000 });
  child.exitCode = 1;
  child.emit('exit', 1);
  await assert.rejects(failed, /服务进程提前退出/);
});

test('terminateChild waits for the child exit event after taskkill returns', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null });
  let killReturned;
  const returned = new Promise((resolve) => { killReturned = resolve; });
  const stopped = terminateChild(child, (done) => {
    done();
    killReturned();
  });
  await returned;
  let settled = false;
  stopped.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'taskkill callback must not be treated as process exit');
  child.exitCode = 0;
  child.emit('exit', 0, null);
  await stopped;
  assert.equal(settled, true);
});

test('terminateChild shares an in-flight termination request', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1235, exitCode: null, signalCode: null });
  let calls = 0;
  const kill = () => { calls += 1; };
  const first = terminateChild(child, kill);
  const second = terminateChild(child, kill);
  assert.equal(first, second);
  assert.equal(calls, 1);
  child.exitCode = 0;
  child.emit('exit', 0, null);
  await Promise.all([first, second]);
});

test('terminateChild allows retry after a timed-out termination', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1236, exitCode: null, signalCode: null });
  let calls = 0;
  const kill = (done) => {
    calls += 1;
    if (calls === 1) done(new Error('taskkill failed'));
    else {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      done();
    }
  };
  await assert.rejects(terminateChild(child, kill, 5), /结束服务进程失败/);
  await terminateChild(child, kill, 50);
  assert.equal(calls, 2, 'a failed termination must not poison later stop attempts');
});

test('ServiceRestarter does not start a scheduled recovery after stop', async () => {
  let starts = 0;
  const restarter = new ServiceRestarter(async () => { starts += 1; }, { cooldownMs: 1 });
  assert.equal(restarter.schedule(), true);
  restarter.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(starts, 0);
});
