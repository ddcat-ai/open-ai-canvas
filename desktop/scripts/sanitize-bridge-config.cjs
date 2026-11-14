const fs = require('node:fs');

const file = process.argv[2];
if (!file) throw new Error('Expected bridge config path');

const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid bridge config');
}

delete config.adminToken;
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
