'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only structured, non-sensitive maintenance summaries are written here.
function writeMaintenanceLog(logDir, result) {
    const file = path.join(logDir, 'main.log');
    const summary = {
        actions: (result.actions || []).map(({ reason, bytes, ok }) => ({ reason, bytes, ok })),
        freedBytes: result.freedBytes || 0, scannedFiles: result.scannedFiles || 0,
        durationMs: result.durationMs || 0, timedOut: Boolean(result.timedOut),
        timedOutCandidates: result.timedOutCandidates || [],
        workerError: Boolean(result.error),
    };
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size >= 1024 * 1024) {
        fs.rmSync(file + '.old', { force: true });
        fs.renameSync(file, file + '.old');
    }
    fs.appendFileSync(file, `${new Date().toISOString()} [storage] ${JSON.stringify(summary)}\n`, 'utf8');
}

module.exports = { writeMaintenanceLog };
