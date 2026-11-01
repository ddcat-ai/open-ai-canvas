import { Button, Modal } from "antd";
import { useRef, useState } from "react";
import type { EcommerceDraft, EcommercePlan } from "@/services/api/ecommerce";
import { assertCommerceClaimsGrounded, assertCommercePlanCurrent, excludeCommerceFacts } from "./planner";
import { CommerceFactReview } from "./fact-review";

export function GenerationConfirmation({
    plan,
    draft,
    busy,
    completed,
    label,
    onConfirm,
    onSupplement,
}: {
    plan: EcommercePlan;
    draft: EcommerceDraft;
    busy: boolean;
    completed: boolean;
    label?: string;
    onConfirm: (reviewed: EcommercePlan) => Promise<void>;
    onSupplement: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState("");
    const locked = useRef(false);
    const remaining = plan.images.filter((image) => !image.taskId).length;
    const submit = async (reviewed: EcommercePlan) => {
        if (locked.current) return;
        locked.current = true;
        setConfirming(true);
        setError("");
        try {
            assertCommercePlanCurrent(reviewed, draft);
            assertCommerceClaimsGrounded(reviewed, draft);
            await onConfirm(reviewed);
            setOpen(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "提交失败，请检查方案后重试");
        } finally {
            locked.current = false;
            setConfirming(false);
        }
    };
    return (
        <>
            {error ? (
                <p className="ecommerce-confirmation-note" role="alert">
                    {error}
                </p>
            ) : null}
            {!completed && plan.uncertainFacts.length ? <p className="ecommerce-confirmation-note">有 {plan.uncertainFacts.length} 项商品信息待核实。点击下方按钮，可补充资料或明确排除未核实内容后继续。</p> : null}
            <Button
                type="primary"
                block
                loading={busy || confirming}
                disabled={busy || completed}
                onClick={() => {
                    setError("");
                    try {
                        assertCommercePlanCurrent(plan, draft);
                    } catch (cause) {
                        setError((cause as Error).message);
                        return;
                    }
                    if (plan.uncertainFacts.length) setOpen(true);
                    else void submit(plan);
                }}
            >
                {label || (completed ? "图片任务已提交" : remaining < plan.images.length ? `继续生成剩余 ${remaining} 张` : `确认并生成 ${plan.images.length} 张`)}
            </Button>
            <Modal
                title="生成前，核对商品信息"
                open={open}
                footer={null}
                onCancel={() => {
                    if (!confirming) setOpen(false);
                }}
                closable={!confirming}
                maskClosable={!confirming}
            >
                <p>以下内容尚未核实，不会自动成为商品事实。你可以补充真实资料后重新策划，或将这些内容作为禁止主张逐张提交。</p>
                {error ? (
                    <p className="ecommerce-confirmation-note" role="alert">
                        {error}
                    </p>
                ) : null}
                <div inert={confirming}>
                    <CommerceFactReview
                        facts={plan.uncertainFacts}
                        onApply={(value) => {
                            onSupplement(value);
                            setOpen(false);
                        }}
                        onExclude={() => void submit(excludeCommerceFacts(plan))}
                        excludeLabel="排除未核实主张并开始生成"
                    />
                </div>
                {confirming ? <p role="status">正在保存已审阅方案并提交图片任务…</p> : null}
            </Modal>
        </>
    );
}
