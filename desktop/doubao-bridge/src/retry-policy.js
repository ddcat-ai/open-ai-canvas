'use strict';

// All recovery paths share one budget. A click or transport timeout is never proof of rejection.
function retryDecision(task, failure, hasOtherAccount) {
  if ((task.meta?.retries || 0) >= 1 || task.submissionState !== 'not_sent') return null;
  switch (failure.reason) {
    case 'login_required':
    case 'quota_exhausted':
      return hasOtherAccount ? { delayMs: 0, switchAccount: true } : null;
    // A hidden desktop-managed browser cannot be made visible as a recovery path.
    // Bot walls require account recovery before a caller can safely retry.
    case 'bot_wall': return null;
    case 'rate_limited': return { delayMs: 20000 };
    case 'mode_unconfirmed': return { delayMs: 0 };
    default: return null;
  }
}

module.exports = { retryDecision };
