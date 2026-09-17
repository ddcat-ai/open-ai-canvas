import { App, Button } from "antd";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { switchUserIdentity } from "@/lib/user-session";
import { exitUserImpersonation } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

// A workspace-wide identity notice, including canvas routes with hidden navigation.
export function ImpersonationReturnControl() {
    const impersonation = useUserStore((state) => state.impersonation);
    const user = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [exiting, setExiting] = useState(false);
    if (!impersonation) return null;

    const exit = async () => {
        setExiting(true);
        try {
            await switchUserIdentity(exitUserImpersonation, "/admin/users");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "返回管理员账号失败");
            setExiting(false);
        }
    };

    return (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border bg-background px-3 py-2 text-caption-1-regular" role="status" data-canvas-no-zoom>
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span>正在以 {user?.displayName || user?.username} 的身份操作 · 来自 {impersonation.actorDisplayName || impersonation.actorUsername}</span>
            <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={exiting} onClick={() => void exit()}>返回管理员</Button>
        </div>
    );
}
