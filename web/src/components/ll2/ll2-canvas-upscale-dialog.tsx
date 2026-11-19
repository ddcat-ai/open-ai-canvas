import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { ll2CanvasUpscaleSourceUrl, ll2CanvasUpscaleTargets, ll2CanvasVideoResolution, ll2CanvasVideoSeconds } from "@/lib/ll2-canvas-upscale";
import { ll2FormatCNY } from "@/lib/ll2-models";
import { ll2UpscaleEstimate, ll2UpscaleTargetLabel, type LL2UpscaleTarget } from "@/lib/ll2-upscale";
import type { CanvasNodeData } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    onConfirm: (target: LL2UpscaleTarget) => void;
};

/** 把上一个视频的选项彻底重置，避免在节点之间串档位。 */
export function LL2CanvasUpscaleDialog(props: Props) {
    return props.open ? <Editor key={props.node.id} {...props} /> : null;
}

function Editor({ node, onClose, onConfirm }: Props) {
    const sourceUrl = ll2CanvasUpscaleSourceUrl(node);
    const sourceResolution = ll2CanvasVideoResolution(node);
    const seconds = ll2CanvasVideoSeconds(node);
    const targets = useMemo(() => ll2CanvasUpscaleTargets(node), [node]);
    const [target, setTarget] = useState<LL2UpscaleTarget | "">(targets[0]?.id || "");
    const estimate = target ? ll2UpscaleEstimate(seconds, target) : null;

    return (
        <AppModal
            open
            centered
            title="超分这条视频"
            width={620}
            onCancel={onClose}
            okText="开始超分"
            okButtonProps={{ disabled: !sourceUrl || !target }}
            onOk={() => target && onConfirm(target as LL2UpscaleTarget)}
        >
            <div className="grid gap-4">
                {sourceUrl ? (
                    <video src={sourceUrl} controls muted playsInline preload="metadata" className="max-h-[240px] w-full rounded-xl bg-black object-contain" />
                ) : (
                    <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        这条视频只存在本机，超分需要一条公网 HTTPS 地址。用首页或画布重新生成一版云端视频再来超分。
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">原片</span>
                    <span className="rounded-full bg-surface-active px-2.5 py-1 font-medium">{sourceResolution} · {seconds} 秒</span>
                </div>

                <div className="grid gap-2">
                    <span className="text-sm font-medium">超分到</span>
                    <div className="flex flex-wrap gap-2">
                        {targets.map((item) => {
                            const active = item.id === target;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-pressed={active}
                                    className={`flex min-w-[96px] flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition ${active ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-primary/50"}`}
                                    onClick={() => setTarget(item.id)}
                                >
                                    <strong className="text-sm">{item.label}</strong>
                                    <small className="text-[11px] text-muted-foreground">¥{ll2FormatCNY(ll2UpscaleEstimate(seconds, item.id).perSecond)}/秒</small>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {estimate ? (
                    <p className="rounded-xl bg-primary/8 px-3 py-2 text-sm">
                        这次预计 <strong className="text-primary">{estimate.label}</strong>
                        <span className="ml-2 text-muted-foreground">{estimate.basis}</span>
                    </p>
                ) : null}

                <ul className="grid gap-1 text-xs text-muted-foreground">
                    <li>· 高清版会作为新视频节点放在原片右边，原片保留不动。</li>
                    <li>· 只给比原片高的档位；费用按成片秒数结算，以 LL2 控制台账单为准。</li>
                    <li>· 超分一般不会失败；万一失败，右边节点会标红，可以再点一次。</li>
                </ul>
            </div>
        </AppModal>
    );
}
