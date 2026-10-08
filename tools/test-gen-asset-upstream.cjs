// Run from web with a test/*.test.ts argument. Execute upstream suites with Node.
// Assertions and
// module mocks stay in the original suites; unsupported matchers fail closed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(process.cwd(), '..');
const web = createRequire(path.join(root, 'web/package.json'));
const { transformSync } = web('rolldown/experimental');
const babel = web('@babel/core');
const paths = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')).compilerOptions.paths;
const cache = new Map(), mocks = new Map(), tests = [];
function resolve(name, parent) {
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias.endsWith('*') ? name.startsWith(alias.slice(0, -1)) : name === alias) {
      name = path.resolve(targets[0].replace('*', name.slice(alias.length - 1)));
      break;
    }
  }
  if (!name.startsWith('.') && !path.isAbsolute(name)) return name;
  const base = path.resolve(path.dirname(parent), name);
  for (const ext of ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx']) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  }
  throw Error('Cannot resolve ' + name + ' from ' + parent);
}
const stringPattern = Symbol('stringMatching');
function resolveMatchers(value, expected) {
  if (expected?.[stringPattern]) {
    assert.equal(typeof value, 'string');
    assert.match(value, expected[stringPattern]);
    return value;
  }
  if (Array.isArray(expected)) return expected.map((item, index) => resolveMatchers(value?.[index], item));
  if (expected && Object.getPrototypeOf(expected) === Object.prototype) {
    return Object.fromEntries(Object.entries(expected).map(([key, item]) => [key, resolveMatchers(value?.[key], item)]));
  }
  return expected;
}
function expect(value, label = '') {
  const matchers = (negate = false) => {
    const check = (fn) => {
      let error;
      try { fn(); } catch (caught) { error = caught; }
      if (negate) assert(error, 'expect(...).not ' + label);
      else if (error) throw new Error('expect(...) ' + label + ': ' + error.message, { cause: error });
    };
    return {
      get not() { return matchers(!negate); },
      toBe: other => check(() => assert.equal(value, other)),
      toEqual: other => check(() => assert.deepEqual(value, resolveMatchers(value, other))),
      toBeNull: () => check(() => assert.equal(value, null)),
      toBeUndefined: () => check(() => assert.equal(value, undefined)),
      toBeDefined: () => check(() => assert.notEqual(value, undefined)),
      toHaveLength: other => check(() => assert.equal(value.length, other)),
      toHaveBeenCalled: () => check(() => assert(value.calls.length > 0)),
      toHaveBeenCalledTimes: other => check(() => assert.equal(value.calls.length, other)),
      toContain: other => check(() => assert(value.includes(other))),
      toBeLessThan: other => check(() => assert(value < other)),
      toBeGreaterThanOrEqual: other => check(() => assert(value >= other)),
      toMatchObject: other => check(() => assert.partialDeepStrictEqual(value, other)),
      toThrow: message => check(() => assert.throws(value, error => message === undefined || (message instanceof RegExp ? message.test(error.message) : error.message.includes(message)))),
      get rejects() { return { toThrow: async message => {
        let rejected = false;
        try { await value; } catch (error) { rejected = true; expect(() => { throw error; }, label).toThrow(message); }
        assert(rejected, 'expect(...).rejects ' + label);
      } }; },
      get resolves() { return new Proxy({}, { get: (_, method) => async (...args) => expect(await value)[method](...args) }); },
    };
  };
  return matchers();
}
const entry = path.resolve(process.argv[2]);
expect.stringMatching = pattern => ({ [stringPattern]: pattern instanceof RegExp ? pattern : new RegExp(pattern) });
let beforeEach = [], afterEach = [];
const api = { expect, test: (name, fn) => {
  const setup = [...beforeEach];
  const teardown = [...afterEach];
  tests.push([name, async () => { try { for (const run of setup) await run(); await fn(); } finally { for (const run of teardown) await run(); } }]);
}, spyOn(object, method) {
  const original = object[method];
  let implementation = original;
  const spy = Object.assign(function (...args) { spy.calls.push(args); return implementation.apply(this, args); }, { calls: [], mockImplementation(fn) { implementation = fn; return spy; }, mockResolvedValue(value) { implementation = async () => value; return spy; }, mockRestore() { object[method] = original; } });
  object[method] = spy;
  return spy;
}, afterEach: fn => afterEach.push(fn), beforeEach: fn => beforeEach.push(fn), describe: (_name, run) => {
  const parent = beforeEach;
  beforeEach = [...parent];
  try { run(); } finally { beforeEach = parent; }
}, mock: { module(name, factory) {
  mocks.set(resolve(name, entry), factory());
} } };
function compile(file) {
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
  const result = transformSync(file, source, { jsx: { runtime: 'automatic' } });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  return babel.transformSync(result.code, { filename: file, configFile: false, babelrc: false,
    plugins: [web.resolve('@babel/plugin-transform-modules-commonjs'), ({ types: t }) => ({ visitor: {
      CallExpression(node) {
        if (node.node.callee.type === 'Import') node.replaceWith(t.callExpression(
          t.memberExpression(t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), []), t.identifier('then')),
          [t.arrowFunctionExpression([], t.callExpression(t.identifier('require'), node.node.arguments))]));
      },
    } })],
  }).code;
}
function load(name, parent = entry) {
  if (name === 'bun:test' || name === 'node:test') return api;
  const file = resolve(name, parent);
  if (mocks.has(file)) return mocks.get(file);
  if (!path.isAbsolute(file)) return web(file);
  if (file.endsWith('.css')) return {};
  if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes('/node_modules/') || file.endsWith('.mjs')) return createRequire(parent)(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  new Function('require', 'module', 'exports', '__filename', '__dirname', compile(file))(
    name => load(name, file), module, module.exports, file, path.dirname(file));
  return module.exports;
}
(async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const module = { exports: {} };
  await new AsyncFunction('require', 'module', 'exports', '__filename', '__dirname', compile(entry))(
    name => load(name, entry), module, module.exports, entry, path.dirname(entry));
  assert(tests.length > 0, 'No tests registered');
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('(pass) ' + name); }
    catch (error) { failed++; console.error('(fail) ' + name, error); }
  }
  console.log(`${tests.length - failed} pass\n ${failed} fail (Node)`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
