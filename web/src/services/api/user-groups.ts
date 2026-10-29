import { http } from "@/services/api/request";

/** 用户端分组徽章外观；none 不展示。 */
export type UserGroupBadgeStyle = "none" | "vip" | "svip";

/** 模型计价货币：credits 直接按积分定价；USD/CNY 下单时按用户分组兑换比例换算成积分。 */
export type PriceCurrency = "credits" | "USD" | "CNY";

/** 分组内单个模型的倍率与兑换比例；0 表示沿用分组默认值。 */
export type UserGroupModelOverride = {
    modelKey: string;
    ratioBasisPoints: number;
    pointsPerUsdMicrocredits: number;
    pointsPerCnyMicrocredits: number;
};

export type UserGroup = {
    id: string;
    code: string;
    name: string;
    description: string;
    badgeLabel: string;
    badgeStyle: UserGroupBadgeStyle;
    sortOrder: number;
    /** 10000 = 1.0（不打折）。 */
    ratioBasisPoints: number;
    /** 1 USD 可兑换的微积分（1 积分 = 1_000_000）。 */
    pointsPerUsdMicrocredits: number;
    pointsPerCnyMicrocredits: number;
    allChannels: boolean;
    isDefault: boolean;
    channelIds: string[];
    modelOverrides: UserGroupModelOverride[];
    userCount: number;
    createdAt: string;
    updatedAt: string;
};

export type UserGroupInput = Pick<UserGroup, "code" | "name" | "description" | "badgeLabel" | "badgeStyle" | "sortOrder" | "ratioBasisPoints" | "pointsPerUsdMicrocredits" | "pointsPerCnyMicrocredits" | "allChannels" | "channelIds" | "modelOverrides">;

/** 会话里的分组展示信息，不含渠道绑定。 */
export type PublicUserGroup = {
    code: string;
    name: string;
    badgeLabel: string;
    badgeStyle: UserGroupBadgeStyle;
    ratioBasisPoints: number;
};

export const DEFAULT_USER_GROUP_CODE = "default";

export const priceCurrencyOptions: Array<{ value: PriceCurrency; label: string }> = [
    { value: "credits", label: "积分" },
    { value: "USD", label: "USD 美元" },
    { value: "CNY", label: "CNY 人民币" },
];

/** 价格单位文案：积分计价显示「积分」，货币计价显示货币代码。 */
export function priceCurrencyUnit(currency?: string) {
    return currency === "USD" || currency === "CNY" ? currency : "积分";
}

export function listAdminUserGroups() {
    return http.get<{ groups: UserGroup[] }>("/admin/user-groups");
}

export function createAdminUserGroup(input: UserGroupInput) {
    return http.post<{ group: UserGroup }>("/admin/user-groups", input);
}

export function updateAdminUserGroup(id: string, input: UserGroupInput) {
    return http.patch<{ group: UserGroup }>(`/admin/user-groups/${encodeURIComponent(id)}`, input);
}

export function deleteAdminUserGroup(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/user-groups/${encodeURIComponent(id)}`);
}

/** 用户 user_group 为空时属于默认分组。 */
export function userGroupCode(value?: string) {
    return value?.trim() || DEFAULT_USER_GROUP_CODE;
}

/** 倍率展示：10000 → "1"，8000 → "0.8"。 */
export function formatRatioBasisPoints(value: number) {
    return (value / 10_000).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}
