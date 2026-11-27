import { startTransition, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { AUDIO_STEM_LABELS, AUDIO_STEM_MAX_BYTES, AUDIO_STEM_MAX_SECONDS, type AudioStemProgress, type AudioStemSelection, type AudioStemTask } from "@/lib/audio-stem/contracts";
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
}: {
    projectId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
}) {
    const { message } = App.useApp();
    const [nodeId, setNodeId] = useState<string | null>(null);
    const [task, setTask] = useState<AudioStemTask | null>(null);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const lifetimeRef = useRef(0);
    useEffect(() => {
        lifetimeRef.current++;
        setNodeId(null);
        setTask(null);
        setError("");
        return () => {
            lifetimeRef.current++;
            controllerRef.current?.abort();
        };
    }, [projectId]);

    const close = () => {
        // 关闭配置仅退出配置，后台任务只能通过任务卡的取消入口中止。
        setNodeId(null);
        setError("");
    };

    const open = (node: CanvasNodeData) => {
        if (controllerRef.current) {
            message.info("音频正在后台分离，可在左下角查看进度或取消");
            return;
        }
        if (node.type !== CanvasNodeType.Audio || node.metadata?.locked || node.metadata?.status === "loading" || node.metadata?.fileUpload) return;
        setError("");
        setNodeId(node.id);
    };

    const run = async (selection: AudioStemSelection, sourceNodeId = nodeId) => {
        if (!sourceNodeId || controllerRef.current) return;
        const failBeforeStart = (detail: string) => {
            if (nodeId) setError(detail);
            else setTask((current) => (current?.nodeId === sourceNodeId ? { ...current, status: "failed", detail } : current));
        };
        const source = nodesRef.current.find((node) => node.id === sourceNodeId);
        if (!source || source.type !== CanvasNodeType.Audio || source.metadata?.locked || source.metadata?.status === "loading" || source.metadata?.fileUpload) {
            failBeforeStart("源音频当前不可处理，请重新选择可用音频");
            return;
        }
        if ((source.metadata?.durationMs || 0) > AUDIO_STEM_MAX_SECONDS * 1000 || (source.metadata?.bytes || 0) > AUDIO_STEM_MAX_BYTES) {
            failBeforeStart("仅支持 3 分钟以内、128 MiB 以下的音频，请先裁剪");
            return;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        const session = localMediaSession();
        const lifetime = lifetimeRef.current;
        const sourceKey = audioStemSourceKey(source);
        const taskId = nanoid();
        const createdIds: string[] = [];
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
        setNodeId(null);
        setTask({ id: taskId, nodeId: source.id, title: source.title || "音频", selection, status: "running", progress: { phase: "reading", percent: 0 }, resultIds: [] });
        const updateProgress = (progress: AudioStemProgress) => {
            if (controller.signal.aborted || lifetime !== lifetimeRef.current) return;
            // 下载回调可能在同一百分比重复触发；去重并降低进度更新优先级，优先响应画布输入。
            startTransition(() =>
                setTask((current) => {
                    if (current?.id !== taskId || current.status !== "running") return current;
                    if (current.progress.phase === progress.phase && current.progress.percent === progress.percent) return current;
                    return { ...current, progress };
                }),
            );
        };
        const finish = (status: AudioStemTask["status"], detail?: string) => setTask((current) => (current?.id === taskId ? { ...current, status, detail, resultIds: [...createdIds] } : current));
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
            const outputs = await separateAudioLocally(input, selection, controller.signal, updateProgress);
            check();
            updateProgress({ phase: "saving", percent: 0 });
            let pendingRemote = false;
            let assetWarning = false;
            // 分别提交每条成功保存的结果；后一条上传失败时保留前一条，明确告知部分完成。
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
                try {
                    const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: result, source: "canvas-manual", signal: controller.signal });
                    check();
                    assetWarning ||= asset.syncPending;
                    setNodes((current) => current.map((node) => (node.id === result.id ? { ...node, metadata: { ...node.metadata, assetId: asset.assetId } } : node)));
                } catch (reason) {
                    check();
                    assetWarning = true;
                }
                updateProgress({ phase: "saving", percent: Math.round((createdIds.length / outputs.length) * 100) });
            }
            check();
            let detail = "已在原音频右侧创建结果，原文件保持不变";
            if (pendingRemote) detail = "结果已缓存本机，尚未上传至服务端";
            else if (assetWarning) detail = "结果已保存，素材库或项目关联待同步";
            finish("succeeded", detail);
        } catch (reason) {
            if (lifetime === lifetimeRef.current) {
                try {
                    assertLocalMediaSession(session);
                } catch {
                    setTask(null);
                    setNodeId(null);
                    return;
                }
                const cancelled = controller.signal.aborted || (reason instanceof Error && reason.name === "AbortError");
                finish(cancelled ? "cancelled" : "failed", `${reason instanceof Error ? reason.message : "音频分离失败"}${createdIds.length ? "。已生成的结果会保留" : ""}`);
            }
        } finally {
            window.clearInterval(guard);
            if (controllerRef.current === controller) controllerRef.current = null;
        }
    };
    const cancel = () => {
        if (!controllerRef.current) return;
        setTask((current) => (current?.status === "running" ? { ...current, status: "cancelling" } : current));
        controllerRef.current.abort(new DOMException("已取消分离", "AbortError"));
    };
    const dismissTask = () => {
        if (!controllerRef.current) setTask(null);
    };
    const retry = () => {
        if (task && task.status !== "running" && task.status !== "cancelling") void run(task.selection, task.nodeId);
    };
    return { nodeId, task, error, open, close, run, cancel, dismissTask, retry };
}
