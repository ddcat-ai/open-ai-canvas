'use strict';

let updater;
function getInstallationUpdater(cacheRoot) {
    if (!updater) {
        const { NsisUpdater } = require('electron-updater');
        updater = new NsisUpdater();
        // The default adapter uses LOCALAPPDATA independently of Electron userData.
        // Keep its Electron HTTP executor, but route every native download/blockmap here.
        Object.defineProperty(updater.app, 'baseCachePath', { value: cacheRoot });
    }
    return updater;
}

module.exports = { getInstallationUpdater };
