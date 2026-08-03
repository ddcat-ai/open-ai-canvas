import { cn } from "@/lib/utils";

type IdentityUser = { identityProvider?: string; identityUsername?: string };

export function isLinuxDOIdentity(user?: IdentityUser | null) {
    return user?.identityProvider?.trim().toLowerCase() === "linuxdo";
}

export function IdentityProviderBadge({ user, compact = false, className }: { user: IdentityUser; compact?: boolean; className?: string }) {
    if (!isLinuxDOIdentity(user)) return null;
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center justify-center border border-border bg-background font-semibold text-foreground/65",
                compact ? "size-3.5 rounded-full text-[var(--fs-micro)] leading-none" : "h-4 rounded px-1 text-[var(--fs-micro)] leading-none",
                className,
            )}
            title={user.identityUsername ? `Linux.do · @${user.identityUsername}` : "Linux.do 用户"}
        >
            {compact ? "L" : "Linux.do"}
        </span>
    );
}
