import { Crown, Gem } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { UserGroupBadgeStyle } from "@/services/api/user-groups";
import { useUserStore } from "@/stores/use-user-store";
import "./user-group-badge.css";

type BadgeGroup = { name?: string; badgeLabel?: string; badgeStyle?: UserGroupBadgeStyle | string } | null | undefined;

function visibleBadgeStyle(group: BadgeGroup): "vip" | "svip" | null {
    return group?.badgeStyle === "vip" || group?.badgeStyle === "svip" ? group.badgeStyle : null;
}

/** 分组徽章：vip 金色、svip 紫粉渐变带流光；none 或未分组时不渲染。 */
export function UserGroupBadge({ group, compact = false, className }: { group?: BadgeGroup; compact?: boolean; className?: string }) {
    const sessionGroup = useUserStore((state) => state.userGroup);
    const resolved = group === undefined ? sessionGroup : group;
    const style = visibleBadgeStyle(resolved);
    if (!style || !resolved) return null;
    const label = resolved.badgeLabel?.trim() || style.toUpperCase();
    const Icon = style === "svip" ? Gem : Crown;
    return (
        // 用 <b> 且文字为直接子节点：所在容器常有 `span` / `em` 后代样式，避免被继承改色。
        <b className={cn("user-group-badge", `is-${style}`, compact && "is-compact", className)} title={resolved.name || label} aria-label={compact ? label : undefined}>
            <Icon aria-hidden />
            {compact ? null : label}
        </b>
    );
}

/** 头像外圈：按当前会话分组给头像加金色或紫粉光环。 */
export function UserGroupAvatarRing({ children, className }: { children: ReactNode; className?: string }) {
    const style = visibleBadgeStyle(useUserStore((state) => state.userGroup));
    return <span className={cn("user-group-avatar-ring", style && `is-${style}`, className)}>{children}</span>;
}
