/**
 * DMC C 端免登录：整个工作区都按游客路径处理。
 * 凭据是用户填写的 DMC API Key（本地保存），不是账号会话。
 */
export function isGuestWorkspacePath(_pathname: string) {
    return true;
}
