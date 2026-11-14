'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function storagePaths(installDir, { smoke = false } = {}) {
    if (!path.isAbsolute(installDir)) throw new Error('Installation directory must be absolute');
    const root = path.join(installDir, smoke ? `.smoke-${process.pid}-${Date.now()}` : 'user-data');
    return {
        root, data: path.join(root, 'data'), logs: path.join(root, 'logs'),
        temp: path.join(root, 'temp'), cache: path.join(root, 'cache'),
        crashes: path.join(root, 'crashes'), updates: path.join(root, 'updates'),
        bridgeData: path.join(root, 'doubao-bridge', 'data'),
        profiles: path.join(root, 'doubao-bridge', 'profiles'),
    };
}

function prepareStorage(paths) {
    for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(paths.root, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
}

function configureElectronStorage(app, paths, env = process.env) {
    app.setPath('userData', paths.root);
    // Keep IndexedDB/localforage at the migrated profile root so browser data survives.
    app.setPath('sessionData', paths.root);
    app.setPath('temp', paths.temp);
    app.setPath('crashDumps', paths.crashes);
    app.setAppLogsPath(paths.logs);
    app.commandLine.appendSwitch('disk-cache-dir', paths.cache);
    app.commandLine.appendSwitch('crash-dumps-dir', paths.crashes);
    env.TEMP = env.TMP = env.TMPDIR = paths.temp;
}

const ignored = /^(?:Singleton(?:Lock|Cookie|Socket)|lockfile|\.write-test-.*)$/;
function hashFile(file) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r');
    const chunk = Buffer.alloc(1024 * 1024);
    try {
        let count;
        while ((count = fs.readSync(fd, chunk, 0, chunk.length, null))) hash.update(chunk.subarray(0, count));
        return hash.digest('hex');
    } finally { fs.closeSync(fd); }
}

function copyVerified(source, destination) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Linked storage entry cannot be migrated: ${source}`);
    if (stat.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        for (const name of fs.readdirSync(source)) {
            if (!ignored.test(name)) copyVerified(path.join(source, name), path.join(destination, name));
        }
    } else if (stat.isFile()) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(destination)) {
            if (hashFile(source) !== hashFile(destination)) throw new Error(`Conflicting migrated data: ${destination}`);
        } else {
            fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
            if (hashFile(source) !== hashFile(destination)) throw new Error(`Storage verification failed: ${destination}`);
        }
        const after = fs.statSync(source);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('Legacy storage changed during migration; close the old client first');
    } else throw new Error(`Unsupported storage entry: ${source}`);
}

function inside(root, file) {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function legacyRoots(paths, legacyUserData) {
    const candidates = Array.isArray(legacyUserData) ? legacyUserData : [legacyUserData];
    const targetRoot = fs.realpathSync(paths.root);
    const entries = [];
    for (const candidate of candidates.filter((value) => typeof value === 'string' && fs.existsSync(value))) {
        const requested = path.resolve(candidate);
        const real = fs.realpathSync(requested);
        // Ignore current data and broad parent directories; copying/removing either
        // could accidentally include the installation or unrelated user files.
        if (inside(targetRoot, real) || inside(real, targetRoot)) continue;
        if (!entries.some((entry) => entry.real === real || inside(entry.real, real))) entries.push({ requested, real });
    }
    return entries;
}

function sameAccountRegistry(source, destination) {
    try {
        const normalize = (file) => {
            const value = JSON.parse(fs.readFileSync(file, 'utf8'));
            const accounts = Array.isArray(value) ? value : value.accounts;
            if (!Array.isArray(accounts)) return null;
            for (const account of accounts) account.userDataDir = `<profile:${account.id}>`;
            return JSON.stringify(value);
        };
        const left = normalize(source);
        return left !== null && left === normalize(destination);
    } catch { return false; }
}

function matchesCopiedTree(source, destination, relative = '') {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !fs.existsSync(destination)) return false;
    const destinationStat = fs.lstatSync(destination);
    if (stat.isDirectory() !== destinationStat.isDirectory() || stat.isFile() !== destinationStat.isFile()) return false;
    if (stat.isDirectory()) return fs.readdirSync(source).filter((name) => !ignored.test(name))
        .every((name) => matchesCopiedTree(path.join(source, name), path.join(destination, name), path.join(relative, name)));
    if (/(?:^|[\\/])doubao-bridge[\\/]data[\\/]accounts\.json(?:\.backup)?$/i.test(relative)) {
        return sameAccountRegistry(source, destination);
    }
    return stat.isFile() && hashFile(source) === hashFile(destination);
}

function removeMigratedRoots(sourceRoots, paths) {
    for (const source of sourceRoots) {
        const stat = fs.lstatSync(source.requested);
        // Keep junctions/symlinks themselves; never recursively remove their targets.
        if (stat.isSymbolicLink()) continue;
        if (!matchesCopiedTree(source.real, paths.root)) {
            throw new Error(`Legacy data changed after migration; preserve and compare it manually: ${source.requested}`);
        }
        fs.rmSync(source.requested, { recursive: true });
    }
}

// Commit only after every copied file is verified. Legacy roots are removed only
// after a durable marker exists and their content still matches the new copy.
function migrateLegacyStorage({ paths, legacyUserData, legacyBridgeDir, oldBridgeDir = legacyBridgeDir, preserveLegacyUserData = [] }) {
    const sourceRoots = legacyRoots(paths, legacyUserData);
    const preserved = new Set(preserveLegacyUserData.map((value) => path.resolve(value).toLowerCase()));
    const removableRoots = sourceRoots.filter((source) => !preserved.has(source.requested.toLowerCase()));
    const marker = path.join(paths.root, '.storage-layout.json');
    if (fs.existsSync(marker)) {
        if (JSON.parse(fs.readFileSync(marker, 'utf8')).schema !== 1) throw new Error('Unsupported desktop storage layout');
        removeMigratedRoots(removableRoots, paths);
        return { migrated: false };
    }
    const stage = path.join(paths.root, '.migration-staging');
    const existing = fs.readdirSync(paths.root).some((name) => {
        // Electron creates its single-instance lock before migration runs.
        if (ignored.test(name)) return false;
        // The installer creates these before the first application launch.
        if (['.migration-staging', 'updates', 'legacy-bridge'].includes(name)) return false;
        const file = path.join(paths.root, name);
        const stat = fs.lstatSync(file);
        return !stat.isDirectory() || fs.readdirSync(file).length > 0;
    });
    // An interrupted commit must resume from its existing stage, not adopt half of a database.
    const resume = fs.existsSync(path.join(stage, '.ready.json'));
    if (!resume) {
        if (existing) throw new Error('Unmarked installation data already exists; preserve it before importing legacy storage');
        if (fs.existsSync(stage)) {
            if (!inside(fs.realpathSync(paths.root), fs.realpathSync(stage))) throw new Error('Migration stage is outside client storage');
            fs.rmSync(stage, { recursive: true });
        }
        fs.mkdirSync(stage, { recursive: true });
        for (const source of sourceRoots) copyVerified(source.real, stage);
        const bridgeRoot = legacyBridgeDir && fs.existsSync(legacyBridgeDir) ? fs.realpathSync(legacyBridgeDir) : null;
        const bridgeData = path.join(stage, 'doubao-bridge', 'data');
        if (bridgeRoot && fs.existsSync(path.join(bridgeRoot, 'data'))) {
            for (const name of fs.readdirSync(path.join(bridgeRoot, 'data'))) {
                if (name !== 'skill-pack.json') copyVerified(path.join(bridgeRoot, 'data', name), path.join(bridgeData, name));
            }
        }
        const profiles = path.join(stage, 'doubao-bridge', 'profiles');
        for (const name of ['accounts.json', 'accounts.json.backup']) {
            const file = path.join(bridgeData, name);
            if (!fs.existsSync(file)) continue;
            const store = JSON.parse(fs.readFileSync(file, 'utf8'));
            const accounts = Array.isArray(store) ? store : store.accounts;
            if (!Array.isArray(accounts)) throw new Error('Invalid legacy account registry');
            for (const account of accounts) {
                if (!/^acct\d+$/.test(account.id) || typeof account.userDataDir !== 'string') throw new Error('Invalid legacy account profile');
                const stored = account.userDataDir;
                let source;
                if (!path.isAbsolute(stored)) {
                    if (bridgeRoot) source = path.resolve(bridgeRoot, stored);
                } else {
                    for (const legacy of sourceRoots) {
                        const requestedRoot = path.resolve(legacy.requested);
                        const storedPath = path.resolve(stored);
                        if (inside(requestedRoot, storedPath)) {
                            source = path.join(legacy.real, path.relative(requestedRoot, storedPath));
                            break;
                        }
                        if (inside(legacy.real, storedPath)) {
                            source = storedPath;
                            break;
                        }
                    }
                }
                if (!source && oldBridgeDir && inside(oldBridgeDir, stored)) {
                    source = bridgeRoot && path.join(bridgeRoot, path.relative(oldBridgeDir, stored));
                } else if (!source && bridgeRoot && inside(bridgeRoot, stored)) {
                    source = stored;
                }
                if (!source || ![...sourceRoots.map((entry) => entry.real), bridgeRoot].some((root) => root && inside(root, source))) throw new Error('Legacy profile is outside client storage');
                if (fs.existsSync(source)) copyVerified(source, path.join(profiles, account.id));
                account.userDataDir = path.join(paths.profiles, account.id);
            }
            fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
        }
        const firstProfiles = sourceRoots.map((entry) => path.join(entry.real, 'doubao-chrome')).filter((file) => fs.existsSync(file));
        if (!fs.existsSync(path.join(bridgeData, 'accounts.json'))) {
            for (const firstProfile of firstProfiles) copyVerified(firstProfile, path.join(profiles, 'acct1'));
        }
        fs.writeFileSync(path.join(stage, '.ready.json'), JSON.stringify({ schema: 1 }));
    }
    function commit(from, to) {
        fs.mkdirSync(to, { recursive: true });
        for (const name of fs.readdirSync(from)) {
            if (name === '.ready.json') continue;
            const source = path.join(from, name), dest = path.join(to, name);
            if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Linked migration stage');
            if (fs.statSync(source).isDirectory()) commit(source, dest);
            else if (fs.existsSync(dest)) {
                if (hashFile(source) !== hashFile(dest)) throw new Error(`Refusing to overwrite current data: ${dest}`);
            } else fs.renameSync(source, dest);
        }
    }
    commit(stage, paths.root);
    const temporaryMarker = marker + '.tmp';
    fs.writeFileSync(temporaryMarker, JSON.stringify({ schema: 1, location: 'installation' }) + '\n');
    fs.renameSync(temporaryMarker, marker);
    removeMigratedRoots(removableRoots, paths);
    fs.rmSync(stage, { recursive: true });
    const oldBridge = path.join(paths.root, 'legacy-bridge');
    if (fs.existsSync(oldBridge)) fs.rmSync(oldBridge, { recursive: true });
    return { migrated: sourceRoots.length > 0 || !!(legacyBridgeDir && fs.existsSync(legacyBridgeDir)) };
}

module.exports = { storagePaths, prepareStorage, configureElectronStorage, migrateLegacyStorage, copyVerified };
