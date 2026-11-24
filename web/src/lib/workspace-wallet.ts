import { workspacePath, workspaceTeamId } from "./workspace-routes";

export const WORKSPACE_WALLET_OPEN_EVENT = "wallet:open";

export type WorkspaceWalletOpenDetail = {
    paymentOrderId?: string;
    paymentInvalid?: boolean;
    /** 打开后所在的标签，默认“充值”。 */
    tab?: "topup" | "redeem" | "income" | "history" | "orders";
    /** 充值页的商品分类，默认“全部”。 */
    category?: "all" | "credits" | "storage";
};

/** 工作台任意入口打开积分中心弹窗，不再进入独立钱包页。 */
export function openWorkspaceWallet(detail: WorkspaceWalletOpenDetail = {}) {
    if (workspaceTeamId) {
        window.location.assign(workspacePath("/wallet"));
        return;
    }
    window.dispatchEvent(new CustomEvent<WorkspaceWalletOpenDetail>(WORKSPACE_WALLET_OPEN_EVENT, { detail }));
}
