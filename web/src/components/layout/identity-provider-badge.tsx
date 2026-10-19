import { cn } from "@/lib/utils";

type IdentityUser = { identityProvider?: string; identityUsername?: string };

export function isLinuxDOIdentity(user?: IdentityUser | null) {
    return user?.identityProvider?.trim().toLowerCase() === "linuxdo";
}

// 第三方身份的展示元数据。provider 值来自后端 UserIdentity.Provider，
// 必须与后端保持一致（linuxdo / google / wechat）。
const IDENTITY_LABELS: Record<string, { short: string; full: string; title: string }> = {
    linuxdo: { short: "L", full: "Linux.do", title: "Linux.do" },
    google: { short: "G", full: "Google", title: "Google" },
    wechat: { short: "W", full: "微信", title: "微信" },
};

export function IdentityProviderBadge({ user, compact = false, className }: { user: IdentityUser; compact?: boolean; className?: string }) {
    const provider = user?.identityProvider?.trim().toLowerCase() || "";
    const meta = IDENTITY_LABELS[provider];
    if (!meta) return null;
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center justify-center border border-border bg-background font-semibold text-foreground/65",
                compact ? "size-3.5 rounded-full text-[var(--fs-micro)] leading-none" : "h-4 rounded px-1 text-[var(--fs-micro)] leading-none",
                className,
            )}
            title={user.identityUsername ? `${meta.title} · ${user.identityUsername}` : `${meta.title} 用户`}
        >
            {compact ? meta.short : meta.full}
        </span>
    );
}
