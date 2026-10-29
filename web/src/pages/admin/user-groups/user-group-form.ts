import type { UserGroup, UserGroupBadgeStyle, UserGroupInput } from "@/services/api/user-groups";

const MICRO = 1_000_000;
const BPS = 10_000;

/** 表单以人类可读单位编辑：倍率是小数，兑换比例是积分；提交时换算回基点和微积分。 */
export type UserGroupOverrideFormValue = {
    modelKey: string;
    ratio?: number | null;
    pointsPerUsd?: number | null;
    pointsPerCny?: number | null;
};

export type UserGroupFormValues = {
    code: string;
    name: string;
    description?: string;
    badgeLabel?: string;
    badgeStyle: UserGroupBadgeStyle;
    sortOrder: number;
    ratio: number;
    pointsPerUsd: number;
    pointsPerCny: number;
    allChannels: boolean;
    channelIds: string[];
    modelOverrides: UserGroupOverrideFormValue[];
};

export function emptyUserGroupForm(): UserGroupFormValues {
    return { code: "", name: "", description: "", badgeLabel: "", badgeStyle: "none", sortOrder: 0, ratio: 1, pointsPerUsd: 7, pointsPerCny: 1, allChannels: false, channelIds: [], modelOverrides: [] };
}

export function userGroupFormValues(group: UserGroup): UserGroupFormValues {
    return {
        code: group.code,
        name: group.name,
        description: group.description,
        badgeLabel: group.badgeLabel,
        badgeStyle: group.badgeStyle,
        sortOrder: group.sortOrder,
        ratio: group.ratioBasisPoints / BPS,
        pointsPerUsd: group.pointsPerUsdMicrocredits / MICRO,
        pointsPerCny: group.pointsPerCnyMicrocredits / MICRO,
        allChannels: group.allChannels,
        channelIds: group.channelIds,
        modelOverrides: group.modelOverrides.map((item) => ({
            modelKey: item.modelKey,
            ratio: item.ratioBasisPoints ? item.ratioBasisPoints / BPS : null,
            pointsPerUsd: item.pointsPerUsdMicrocredits ? item.pointsPerUsdMicrocredits / MICRO : null,
            pointsPerCny: item.pointsPerCnyMicrocredits ? item.pointsPerCnyMicrocredits / MICRO : null,
        })),
    };
}

function toUnits(value: number | null | undefined, scale: number) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * scale) : 0;
}

export function userGroupInput(values: UserGroupFormValues): UserGroupInput {
    return {
        code: values.code.trim().toLowerCase(),
        name: values.name.trim(),
        description: values.description?.trim() || "",
        badgeLabel: values.badgeLabel?.trim() || "",
        badgeStyle: values.badgeStyle,
        sortOrder: values.sortOrder || 0,
        ratioBasisPoints: toUnits(values.ratio, BPS),
        pointsPerUsdMicrocredits: toUnits(values.pointsPerUsd, MICRO),
        pointsPerCnyMicrocredits: toUnits(values.pointsPerCny, MICRO),
        allChannels: values.allChannels,
        channelIds: values.allChannels ? [] : values.channelIds,
        modelOverrides: (values.modelOverrides || [])
            .filter((item) => item?.modelKey?.trim())
            .map((item) => ({
                modelKey: item.modelKey.trim(),
                ratioBasisPoints: toUnits(item.ratio, BPS),
                pointsPerUsdMicrocredits: toUnits(item.pointsPerUsd, MICRO),
                pointsPerCnyMicrocredits: toUnits(item.pointsPerCny, MICRO),
            })),
    };
}

export function formatPoints(microcredits: number) {
    return (microcredits / MICRO).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
