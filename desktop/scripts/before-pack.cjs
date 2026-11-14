const path = require('node:path');
const { verifyResources } = require('./resource-manifest.cjs');

module.exports = function beforePack(context) {
  const { appInfo, projectDir, config } = context.packager;
  const edition = config.extraMetadata?.peekreel?.edition;
  if (!['full', 'lite'].includes(edition)) throw new Error('Builder must declare peekreel.edition');
  verifyResources(path.join(projectDir, 'resources'), edition, appInfo.version);
};
