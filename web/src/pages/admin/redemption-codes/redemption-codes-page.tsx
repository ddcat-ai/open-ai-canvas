import { Button } from "antd";
import { TicketCheck } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { AdminPageFrame } from "../components/admin-shell";

const RedemptionCodesPanel = lazy(() => import("../components/redemption-codes-panel"));

export default function RedemptionCodesPage() {
    const [createOpen, setCreateOpen] = useState(false);
    const [createBlocked, setCreateBlocked] = useState(false);

    return (
        <AdminPageFrame
            title="兑换码"
            description="批次发放、核销状态与明细追踪"
            actions={
                <Button type="primary" disabled={createBlocked} title={createBlocked ? "请先核对上一次结果不确定的生成请求" : undefined} icon={<TicketCheck className="size-4" />} onClick={() => setCreateOpen(true)}>
                    生成批次
                </Button>
            }
        >
            <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">正在读取兑换码批次...</div>}>
                <RedemptionCodesPanel createOpen={createOpen} onCreateOpenChange={setCreateOpen} onCreateBlockedChange={setCreateBlocked} />
            </Suspense>
        </AdminPageFrame>
    );
}
