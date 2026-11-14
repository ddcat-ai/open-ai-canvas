'use strict';

function conversationTarget(tasks, accounts, taskId, accountId, attempt) {
  const fail = (status, detail) => { throw Object.assign(new Error(detail), { status }); };
  if (!taskId || !accountId || !Number.isInteger(attempt)) fail(400, '需要 taskId、account 和 attempt');
  const task = tasks.get(taskId);
  if (!task) fail(404, '任务不存在');
  const account = accounts.get(accountId);
  if (task.status !== 'processing' || task.accountId !== accountId || task.attempt !== attempt ||
      !account?.driver || account.driver.state.activeTask !== task) {
    fail(409, '任务尚未就绪或已切换，请等待状态刷新');
  }
  return { task, driver: account.driver };
}

module.exports = { conversationTarget };
