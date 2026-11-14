'use strict';
const path = require('node:path');
// Standalone bridge runs next to its package; desktop always passes explicit paths.
const userRoot = path.resolve(__dirname, '..', 'runtime');
function absolute(name, fallback) {
  const value = process.env[name] || fallback;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path.resolve(value);
}
const dataDir = absolute('BRIDGE_DATA_DIR', path.join(userRoot, 'doubao-bridge', 'data'));
const profileDir = absolute('BRIDGE_PROFILE_DIR', path.join(userRoot, 'doubao-bridge', 'profiles'));
module.exports = { dataDir, profileDir, templateFile: path.join(__dirname, '..', 'data', 'skill-pack.json') };
