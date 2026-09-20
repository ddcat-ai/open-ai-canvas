export const WORKSPACE_WALLET_OPEN_EVENT = "wallet:open";

export type WorkspaceWalletOpenDetail = {
    paymentOrderId?: string;
    paymentInvalid?: boolean;
};

/** 工作台任意入口打开积分中心弹窗，不再进入独立钱包页。 */
export function openWorkspaceWallet(detail: WorkspaceWalletOpenDetail = {}) {
    window.dispatchEvent(new CustomEvent<WorkspaceWalletOpenDetail>(WORKSPACE_WALLET_OPEN_EVENT, { detail }));
}
