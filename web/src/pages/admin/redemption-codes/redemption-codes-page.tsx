import { lazy, Suspense } from "react";

import { AdminPageFrame } from "../components/admin-shell";

const RedemptionCodesPanel = lazy(() => import("../components/redemption-codes-panel"));

export default function RedemptionCodesPage() {
    return (
        <AdminPageFrame title="兑换码" description="生成与查看兑换码批次">
            <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">正在读取兑换码批次...</div>}>
                <RedemptionCodesPanel />
            </Suspense>
        </AdminPageFrame>
    );
}
