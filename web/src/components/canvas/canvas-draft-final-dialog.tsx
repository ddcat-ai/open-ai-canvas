import { AppModal } from "@/components/ui/product/app-modal";
import { requestCreditCost, CreditSymbol } from "@/constant/credits";
import { draftVideoExpired } from "@/components/canvas/canvas-node";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

type DraftFinalDialogProps = {
    node: CanvasNodeData;
    config: AiConfig;
    submitting: boolean;
    onClose: () => void;
    onConfirm: (node: CanvasNodeData) => void;
};

/**
 * 「基于样片生成正式视频」确认框：正式版固定 1080p，提示词、参考素材、时长与比例由
 * 模型自动复用样片任务取值（不可改，重复传会触发上游报错）；两步独立计费。
 */
export function CanvasDraftFinalDialog({ node, config, submitting, onClose, onConfirm }: DraftFinalDialogProps) {
    const createdAt = node.metadata?.taskCreatedAt || node.metadata?.taskCompletedAt;
    const expired = draftVideoExpired(createdAt);
    const expiresAt = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60 * 1000) : null;
    const draftModel = String(node.metadata?.model || config.model);
    const priceChannel = resolveModelChannel(config, draftModel);
    const draftSeconds = node.metadata?.seconds || config.videoSeconds;
    // 两步独立计费：样片按 480P 档（本节点已支付，供对照），正式版按 1080P 档预估；
    // requestCreditCost 复用提交按钮同款估算口径，金额始终来自当前渠道配置的价格档。
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(draftModel),
        seconds: draftSeconds,
        capability: "video",
        config: { ...config, model: draftModel, vquality: "1080p" },
    });
    const draftCredits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(draftModel),
        seconds: draftSeconds,
        capability: "video",
        config: { ...config, model: draftModel, vquality: "480p" },
    });
    return (
        <AppModal
            open
            centered
            title="生成正式视频（1080P）"
            okText={submitting ? "正在生成…" : "生成正式视频"}
            okButtonProps={{ disabled: expired || submitting, loading: submitting }}
            onCancel={onClose}
            onOk={() => onConfirm(node)}
        >
            <div className="space-y-3 text-sm">
                <p className="m-0">
                    将基于样片任务生成 <strong>1080P</strong> 正式视频。提示词、参考素材、时长与比例由模型自动复用样片取值，无需也不能修改。
                </p>
                <ul className="m-0 list-disc space-y-1 pl-5 text-muted-foreground">
                    <li>两步独立计费：样片（480P）已计费{draftCredits && draftCredits > 0 ? <>约 {draftCredits} <CreditSymbol /></> : null}；本次正式版按 1080P 价格档扣费，预估 {credits && credits > 0 ? <>{credits} <CreditSymbol /></> : "见渠道价格档"}。</li>
                    <li>抽卡重生成建议只在便宜的 480P 样片阶段做，满意后再升正式版；仅成功生成才计费。</li>
                    {expiresAt ? <li>样片任务有效期至 {expiresAt.toLocaleString()}，过期后无法生成正式版。</li> : null}
                </ul>
                {expired ? <p role="alert" className="m-0 text-sm text-destructive">样片任务已接近或超过 7 天有效期（为避免上游拒单已提前拦截），请重新生成样片后再出正式版。</p> : null}
            </div>
        </AppModal>
    );
}
