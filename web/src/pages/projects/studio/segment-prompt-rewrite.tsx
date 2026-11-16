import { Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";
import type { DramaModelChoice, DramaSegment } from "@/services/api/drama";
import { rewriteDramaVideoPrompt } from "@/services/drama-prompt-rewrite";
import { useEffectiveConfig } from "@/stores/use-config-store";

export function SegmentPromptRewrite({
    projectId,
    episodeId,
    segment,
    prompt,
    model,
    disabled,
    onApply,
}: {
    projectId: string;
    episodeId: string;
    segment: DramaSegment;
    prompt: string;
    model: DramaModelChoice;
    disabled: boolean;
    onApply: (prompt: string) => void;
}) {
    const config = useEffectiveConfig();
    const [instruction, setInstruction] = useState("");
    const [candidate, setCandidate] = useState("");
    const [source, setSource] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const currentSource = JSON.stringify([prompt, segment.request]);
    const stale = Boolean(source && source !== currentSource);
    useEffect(() => () => abortRef.current?.abort(), []);

    const rewrite = async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setError("");
        const baseline = currentSource;
        try {
            const next = await rewriteDramaVideoPrompt({ projectId, episodeId, segment, prompt: !stale && candidate ? candidate : prompt, instruction, model, config, signal: controller.signal });
            if (controller.signal.aborted) return;
            setCandidate(next);
            setSource(baseline);
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "AI 修改失败");
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    return (
        <details className="mt-3 rounded-[var(--radius-md)] border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">让 AI 按要求修改</summary>
            <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">填写修改要求，先查看候选，再决定采用；可基于候选继续修改。调用作品的提示词文本模型，按实际用量计费。</p>
                <Input.TextArea
                    aria-label="提示词修改要求"
                    value={instruction}
                    maxLength={2000}
                    rows={3}
                    disabled={busy}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder="例如：把打斗改为对峙，用人物反应和镜头切换表现冲突，去掉血腥描写，保留台词和参考图编号。"
                />
                {candidate ? <Input.TextArea aria-label="AI 修改候选" value={candidate} readOnly rows={8} /> : null}
                {stale ? (
                    <p role="status" className="text-sm text-muted-foreground">
                        原提示词或参考素材已变化，请基于最新内容重新修改。
                    </p>
                ) : null}
                {error ? (
                    <p role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                    <Button loading={busy} disabled={disabled || !prompt.trim() || !instruction.trim()} onClick={() => void rewrite()}>
                        {candidate && !stale ? "按新要求继续修改" : "生成修改候选"}
                    </Button>
                    {candidate ? (
                        <>
                            <Button
                                type="primary"
                                disabled={disabled || busy || stale}
                                onClick={() => {
                                    onApply(candidate);
                                    setCandidate("");
                                    setSource("");
                                }}
                            >
                                采用这版提示词
                            </Button>
                            <Button
                                disabled={busy}
                                onClick={() => {
                                    setCandidate("");
                                    setSource("");
                                    setError("");
                                }}
                            >
                                放弃候选
                            </Button>
                        </>
                    ) : null}
                </div>
            </div>
        </details>
    );
}
