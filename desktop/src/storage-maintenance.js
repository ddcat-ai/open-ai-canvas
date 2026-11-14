'use strict';
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

function context(options) {
    return { root: path.resolve(options.userDataDir), deadline: Date.now() + (options.budgetMs ?? 750),
        scannedFiles: 0, freedBytes: 0, timedOut: false, timedOutCandidates: [] };
}
function checkBudget(ctx) {
    if (Date.now() >= ctx.deadline) {
        ctx.timedOut = true;
        throw new Error('Maintenance budget exhausted');
    }
}
function safePath(ctx, target) {
    checkBudget(ctx);
    const relative = path.relative(ctx.root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
    let current = ctx.root;
    if (fs.lstatSync(current).isSymbolicLink()) return false;
    for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) return false;
    }
    return true;
}

// A linked or unreadable subtree is never interpreted as a complete, safe cleanup candidate.
function scan(ctx, dir) {
    if (!safePath(ctx, dir)) throw new Error('Linked cache path');
    const files = [];
    const dirs = [];
    const stack = [dir];
    let bytes = 0;
    while (stack.length) {
        checkBudget(ctx);
        const current = stack.pop();
        if (!safePath(ctx, current)) throw new Error('Linked cache path');
        dirs.push(current);
        const handle = fs.opendirSync(current);
        try {
            let entry;
            while ((entry = handle.readSync())) {
                checkBudget(ctx);
                const full = path.join(current, entry.name);
                const stat = fs.lstatSync(full);
                ctx.scannedFiles += 1;
                if (stat.isSymbolicLink()) throw new Error('Linked cache entry');
                if (stat.isDirectory()) stack.push(full);
                else if (stat.isFile()) { files.push({ full, bytes: stat.size }); bytes += stat.size; }
                else throw new Error('Unsupported cache entry');
            }
        } finally { handle.closeSync(); }
    }
    return { files, dirs, bytes };
}

function dirSize(dir) {
    try { return scan(context({ userDataDir: path.dirname(dir), budgetMs: 5000 }), dir).bytes; }
    catch { return 0; }
}
function buildPlan(options, ctx) {
    const candidates = [
        ['Service Worker/CacheStorage', options.cacheBudgetBytes ?? 300 * 1024 * 1024],
        ['Cache', 64 * 1024 * 1024],
        ['Code Cache', 64 * 1024 * 1024], ['GPUCache', 64 * 1024 * 1024],
    ];
    const actions = [];
    for (const [name, budget] of candidates) {
        ctx.deadline = Date.now() + (options.budgetMs ?? 250);
        ctx.timedOut = false;
        const target = path.join(ctx.root, name);
        try {
            const tree = scan(ctx, target);
            if (tree.bytes > budget) actions.push({ target, reason: name + ' exceeds cache budget', bytes: tree.bytes });
        } catch { /* Missing, unreadable, linked, or over budget: preserve it. */ }
        if (ctx.timedOut) ctx.timedOutCandidates.push(name);
    }
    return actions;
}
function planMaintenance(options) { return buildPlan(options, context(options)); }

function runStorageMaintenance(options) {
    const started = Date.now();
    const ctx = context(options);
    const actions = buildPlan(options, ctx).map((action) => {
        try {
            ctx.deadline = Date.now() + (options.budgetMs ?? 250);
            ctx.timedOut = false;
            // Rescan immediately before deletion; never follow links or enter business data paths.
            const tree = scan(ctx, action.target);
            for (const file of tree.files) {
                if (!safePath(ctx, file.full)) throw new Error('Cache path changed');
                fs.unlinkSync(file.full);
                ctx.freedBytes += file.bytes;
            }
            for (const dir of tree.dirs.reverse()) {
                if (!safePath(ctx, dir)) throw new Error('Cache path changed');
                fs.rmdirSync(dir);
            }
            return { ...action, ok: true };
        } catch {
            if (ctx.timedOut) ctx.timedOutCandidates.push(action.reason + ' (deletion)');
            return { ...action, ok: false };
        }
    });
    return { actions, freedBytes: ctx.freedBytes, scannedFiles: ctx.scannedFiles,
        durationMs: Date.now() - started, timedOut: ctx.timedOutCandidates.length > 0,
        timedOutCandidates: ctx.timedOutCandidates };
}

function runStorageMaintenanceWorker(options, timeoutMs = 3000) {
    const started = Date.now();
    return new Promise((resolve) => {
        const worker = new Worker(__filename, { workerData: options });
        let result;
        let workerError;
        const timer = setTimeout(() => {
            // Do not create the persistent Chromium session until the worker has stopped deleting.
            void worker.terminate();
        }, timeoutMs);
        worker.on('message', (message) => { result = message; });
        worker.on('error', (error) => { workerError = error.message; });
        worker.on('exit', () => {
            clearTimeout(timer);
            resolve(result || { actions: [], freedBytes: 0, scannedFiles: 0,
                durationMs: Date.now() - started, timedOut: true, error: workerError });
        });
    });
}
if (!isMainThread) parentPort.postMessage(runStorageMaintenance(workerData));
module.exports = { planMaintenance, runStorageMaintenance, runStorageMaintenanceWorker, dirSize };
