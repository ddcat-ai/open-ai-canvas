// Only the application's top-level local page may use privileged bridge IPC.
function isTrustedMainFrame(event, window, localUrl) {
    if (!window || window.isDestroyed() || !localUrl || event.sender !== window.webContents) return false;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return false;
    try { return new URL(frame.url).origin === new URL(localUrl).origin; }
    catch { return false; }
}

module.exports = { isTrustedMainFrame };
