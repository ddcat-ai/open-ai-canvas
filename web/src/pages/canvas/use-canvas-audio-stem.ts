import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { AUDIO_STEM_LABELS, AUDIO_STEM_MAX_BYTES, AUDIO_STEM_MAX_SECONDS, type AudioStemProgress, type AudioStemSelection } from "@/lib/audio-stem/contracts";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { audioMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { separateAudioLocally } from "@/services/audio-stem";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { assertLocalMediaSession, localMediaSession } from "@/services/local-media-object-urls";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function audioStemSourceKey(node: CanvasNodeData) {
    return JSON.stringify([node.metadata?.storageKey, node.metadata?.content]);
}

export function useCanvasAudioStem({
    projectId,
    domainProjectId,
    nodesRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
}: {
    projectId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
}) {
    const { message } = App.useApp();
    const [nodeId, setNodeId] = useState<string | null>(null);
    const [progress, setProgress] = useState<AudioStemProgress | null>(null);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const lifetimeRef = useRef(0);
    useEffect(() => {
        lifetimeRef.current++;
        setNodeId(null);
        setProgress(null);
        setError("");
        return () => {
            lifetimeRef.current++;
            controllerRef.current?.abort();
        };
    }, [projectId]);

    const close = () => {
        controllerRef.current?.abort();
        setNodeId(null);
        setError("");
    };

    const open = (node: CanvasNodeData) => {
        if (controllerRef.current) {
            message.info("请先等待当前分离完成，或取消后再操作");
            return;
        }
        if (node.type !== CanvasNodeType.Audio || node.metadata?.locked || node.metadata?.status === "loading" || node.metadata?.fileUpload) return;
        setError("");
        setNodeId(node.id);
    };

    const run = async (selection: AudioStemSelection) => {
        if (!nodeId || controllerRef.current) return;
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source || source.type !== CanvasNodeType.Audio || source.metadata?.locked || source.metadata?.status === "loading" || source.metadata?.fileUpload) {
            setError("源音频当前不可处理");
            return;
        }
        if ((source.metadata?.durationMs || 0) > AUDIO_STEM_MAX_SECONDS * 1000 || (source.metadata?.bytes || 0) > AUDIO_STEM_MAX_BYTES) {
            setError("仅支持 3 分钟以内、128 MiB 以下的音频，请先裁剪");
            return;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        const session = localMediaSession();
        const lifetime = lifetimeRef.current;
        const sourceKey = audioStemSourceKey(source);
        const check = () => {
            controller.signal.throwIfAborted();
            assertLocalMediaSession(session);
            const latest = nodesRef.current.find((node) => node.id === source.id);
            if (lifetime !== lifetimeRef.current || !latest || latest.type !== CanvasNodeType.Audio || latest.metadata?.locked || latest.metadata?.status === "loading" || latest.metadata?.fileUpload || audioStemSourceKey(latest) !== sourceKey)
                throw new DOMException("画布或源音频已变化，请重新分离", "AbortError");
            return latest;
        };
        // 不等待推理完成才发现会话失效；尽早停止下载和销毁持有模型的 Worker。
        const guard = window.setInterval(() => {
            try {
                check();
            } catch (reason) {
                controller.abort(reason);
            }
        }, 250);
        setError("");
        setProgress({ phase: "reading", percent: 0 });
        try {
            let input = source.metadata?.storageKey ? await getMediaBlob(source.metadata.storageKey, controller.signal) : null;
            check();
            if (!input && source.metadata?.content) {
                const url = new URL(source.metadata.content, location.href);
                const response = await fetch(url, { signal: controller.signal, credentials: url.origin === location.origin ? "same-origin" : "omit" });
                if (!response.ok) throw new Error(`音频读取失败（${response.status}）`);
                input = await response.blob();
            }
            check();
            if (!input) throw new Error("找不到原始音频，请重新上传");
            const outputs = await separateAudioLocally(input, selection, controller.signal, setProgress);
            check();
            setProgress({ phase: "saving", percent: 0 });
            let pendingRemote = false;
            let assetWarning = false;
            // 分别提交每条成功保存的结果；后一条上传失败时保留前一条，明确告知部分完成。
            const createdIds: string[] = [];
            for (const output of outputs) {
                check();
                const label = AUDIO_STEM_LABELS[output.stem];
                const uploaded = await uploadMediaFile(new File([output.blob], `${source.title || "音频"}-${label}.wav`, { type: "audio/wav" }), "audio", undefined, { signal: controller.signal, expectedUserId: session.scope });
                const latest = check();
                pendingRemote ||= Boolean(uploaded.pendingRemoteUpload);
                const size = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const result = createCanvasNode(
                    CanvasNodeType.Audio,
                    {
                        x: latest.position.x + latest.width + 96 + size.width / 2,
                        y: latest.position.y + size.height / 2 + createdIds.length * (size.height + 48),
                    },
                    { ...audioMetadata(uploaded), prompt: `从「${source.title || "音频"}」提取${label}` },
                );
                result.title = `${source.title || "音频"} · ${label}`;
                setNodes((current) => [...current, result]);
                setConnections((current) => [...current, { id: nanoid(), fromNodeId: source.id, toNodeId: result.id }]);
                createdIds.push(result.id);
                setSelectedNodeIds(new Set(createdIds));
                try {
                    const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: result, source: "canvas-manual", signal: controller.signal });
                    check();
                    assetWarning ||= asset.syncPending;
                    setNodes((current) => current.map((node) => (node.id === result.id ? { ...node, metadata: { ...node.metadata, assetId: asset.assetId } } : node)));
                } catch (reason) {
                    check();
                    assetWarning = true;
                }
                setProgress({ phase: "saving", percent: Math.round((createdIds.length / outputs.length) * 100) });
            }
            check();
            setNodeId(null);
            if (pendingRemote) message.warning("分离完成，结果已缓存本机，尚未上传至服务端");
            else if (assetWarning) message.warning("分离结果已保存，素材库或项目关联尚未同步完成");
            else message.success("分离完成，已创建新的音频节点");
        } catch (reason) {
            if (lifetime === lifetimeRef.current) {
                if (controller.signal.aborted || (reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "操作已取消");
                else setError(`${reason instanceof Error ? reason.message : "音频分离失败"}。已生成的结果会保留。`);
            }
        } finally {
            window.clearInterval(guard);
            if (controllerRef.current === controller) controllerRef.current = null;
            if (lifetime === lifetimeRef.current) setProgress(null);
        }
    };
    return { nodeId, progress, error, open, close, run };
}
