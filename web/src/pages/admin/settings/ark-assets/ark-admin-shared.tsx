// 管理端方舟素材库共用的标签、状态与格式化。

import type { ArkAssetStatus, ArkGroupKind, ArkPortraitGroup, ArkUserSummary } from "@/services/api/ark-portraits";
import { AdminStatusBadge, type AdminStatusTone } from "../../components/admin-ui";

export const ARK_KIND_LABEL: Record<ArkGroupKind, string> = { real: "真人", virtual: "虚拟", ip: "版权 IP" };

export const ARK_SOURCE_LABEL: Record<string, string> = { liveness: "H5 认证", created: "平台创建", manual: "控制台登记" };

export const ARK_ASSET_STATUS: Record<ArkAssetStatus, { label: string; tone: AdminStatusTone }> = {
    pending_review: { label: "待审核", tone: "warning" },
    rejected: { label: "已驳回", tone: "error" },
    processing: { label: "方舟审核中", tone: "info" },
    active: { label: "已通过", tone: "success" },
    failed: { label: "未通过", tone: "error" },
};

export function ArkAssetStatusBadge({ status }: { status: string }) {
    const meta = ARK_ASSET_STATUS[status as ArkAssetStatus];
    return <AdminStatusBadge label={meta?.label || status} tone={meta?.tone || "neutral"} />;
}

export function formatArkAdminDate(value?: string, withTime = false) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("zh-CN", withTime ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 真人素材组的授权期限；虚拟与版权 IP 长期有效。 */
export function ArkExpiryBadge({ group }: { group: Pick<ArkPortraitGroup, "kind" | "expiresAt" | "expiryStatus"> }) {
    if (group.kind !== "real" || !group.expiresAt || group.expiryStatus === "none") return <AdminStatusBadge label="长期有效" />;
    if (group.expiryStatus === "expired") return <AdminStatusBadge label={`已于 ${formatArkAdminDate(group.expiresAt)} 过期`} tone="error" />;
    if (group.expiryStatus === "expiring") return <AdminStatusBadge label={`${formatArkAdminDate(group.expiresAt)} 到期`} tone="warning" />;
    return <AdminStatusBadge label={`授权至 ${formatArkAdminDate(group.expiresAt)}`} tone="success" />;
}

export function arkUserLabel(user?: ArkUserSummary) {
    if (!user) return "-";
    if (user.displayName && user.username) return `${user.displayName}（${user.username}）`;
    return user.displayName || user.username || user.id;
}

export function arkGrantSummary(group: Pick<ArkPortraitGroup, "scope" | "grantAll" | "grantUsers">) {
    if (group.scope !== "platform") return "仅创建者";
    if (group.grantAll) return "全部用户";
    const count = group.grantUsers?.length || 0;
    return count ? `${count} 位用户` : "未授权";
}
