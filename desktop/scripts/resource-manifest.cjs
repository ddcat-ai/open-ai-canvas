const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const MANIFEST = 'build-manifest.json';
const RESOURCE_NAMES = ['web-dist', 'canvas-backend.exe', 'plugin-packages', 'doubao-bridge'];

function inventory(root) {
  const files = [];
  function visit(relative) {
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Resource link is not allowed: ${relative}`);
    if (relative.split('/').some((name) => /^(?:chrome-profile|\.bak-trim-|\.env(?:\.|$))/.test(name)) ||
        (relative.startsWith('doubao-bridge/data/') && relative !== 'doubao-bridge/data/skill-pack.json')) {
      throw new Error(`Runtime/private data found in resources: ${relative}`);
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(`${relative}/${name}`);
      return;
    }
    if (!stat.isFile()) throw new Error(`Unsupported resource: ${relative}`);
    files.push({ path: relative, bytes: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
  }
  for (const name of fs.readdirSync(root)) {
    if (name !== MANIFEST && !RESOURCE_NAMES.includes(name)) throw new Error(`Unexpected resource: ${name}`);
  }
  for (const name of RESOURCE_NAMES) visit(name);
  return files;
}

function verifyResources(root, edition, version, revision) {
  if (!['lite', 'full'].includes(edition)) throw new Error('Invalid client edition');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  const web = JSON.parse(fs.readFileSync(path.join(root, 'web-dist', 'client-build.json'), 'utf8'));
  const bridgeConfig = JSON.parse(fs.readFileSync(path.join(root, 'doubao-bridge', 'config.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.edition !== edition || manifest.version !== version ||
      !/^[a-f0-9]{40,64}$/.test(manifest.revision) || (revision && manifest.revision !== revision)) {
    throw new Error('Resource edition/version/revision mismatch; run prepare-resources.ps1 again');
  }
  if (web.edition !== edition || web.version !== manifest.webVersion || web.revision !== manifest.revision) {
    throw new Error('Frontend build does not match the desktop resources');
  }
  if (bridgeConfig.adminToken) throw new Error('Static bridge tokens must not be packaged');
  const files = inventory(root);
  const names = new Set(files.map((file) => file.path));
  for (const name of ['web-dist/index.html', 'doubao-bridge/src/server.js', 'doubao-bridge/config.json',
    'doubao-bridge/package.json', 'doubao-bridge/node_modules/puppeteer-core/package.json']) {
    if (!names.has(name)) throw new Error(`Missing runtime resource: ${name}`);
  }
  if (!files.some((file) => /^plugin-packages\/.+\.yingce-plugin$/.test(file.path))) {
    throw new Error('Official plugins are missing');
  }
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error('Resources changed after preparation');
  return manifest;
}

function writeManifest(root, edition, version, webVersion, revision) {
  const clientBuild = { edition, version: webVersion, revision };
  fs.writeFileSync(path.join(root, 'web-dist', 'client-build.json'), JSON.stringify(clientBuild, null, 2) + '\n');
  const manifest = { schema: 1, edition, version, webVersion, revision, files: inventory(root) };
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return verifyResources(root, edition, version, revision);
}

module.exports = { inventory, verifyResources, writeManifest };

if (require.main === module) {
  const [command, root, edition, revision] = process.argv.slice(2);
  const { version } = require('../package.json');
  const webVersion = process.env.CANVAS_BUILD_VERSION?.trim() || fs.readFileSync(path.resolve(__dirname, '../../VERSION'), 'utf8').trim();
  try {
    if (command === 'inspect') inventory(root);
    else if (command === 'write') writeManifest(root, edition, version, webVersion, revision);
    else if (command === 'verify') verifyResources(root, edition, version, revision);
    else if (command === 'smoke') {
      verifyResources(root, edition, version, revision);
      const bridgeRequire = createRequire(path.resolve(root, 'doubao-bridge/package.json'));
      bridgeRequire('puppeteer-core');
      bridgeRequire('./src/server.js');
    }
    else throw new Error('Expected inspect, write, verify or smoke');
    console.log(`Resources ${command}: ${edition || ''} ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
