const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

const release = path.resolve(__dirname, '../release');
const metadata = yaml.load(fs.readFileSync(path.join(release, 'latest.yml'), 'utf8'));
const { version } = require('../package.json');
if (metadata.version !== version || !metadata.files?.length) throw new Error('Invalid update version/files');
for (const file of metadata.files) {
  if (path.basename(file.url) !== file.url || !file.url.endsWith('.exe')) throw new Error('Invalid installer name');
  const installer = fs.readFileSync(path.join(release, file.url));
  const hash = crypto.createHash('sha512').update(installer).digest('base64');
  if (file.size !== installer.length || file.sha512 !== hash) throw new Error('Update size/hash mismatch');
  if (metadata.path !== file.url || metadata.sha512 !== hash) throw new Error('Update path/hash mismatch');
  console.log(`Update verified: ${file.url} ${installer.length} bytes`);
}
