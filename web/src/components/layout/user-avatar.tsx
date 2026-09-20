import { useEffect, useState } from "react";
import { CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalUser } from "@/stores/use-user-store";

export function UserAvatar({ user, className }: { user: LocalUser; className?: string }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user.avatarUrl || "") ? user.avatarUrl : "";

    useEffect(() => setFailed(false), [avatarUrl]);

    // 结构保持 button > span > svg：占位图标自动复用顶栏图标按钮的 18px/1.8 描边与配色合同；默认不套圆角容器，hover 由按钮背景反馈。
    return (
        <span className={cn("grid shrink-0 place-items-center overflow-hidden", className)}>
            {avatarUrl && !failed ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <CircleUserRound className="size-full" aria-hidden />
            )}
        </span>
    );
}
