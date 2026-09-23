import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Select, Slider, Tag } from "antd";
import { AudioLines, Download, Play, RefreshCw, Upload, Wand2 } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useNodeRunningStatus } from "@/lib/canvas/plugin-node-running-status";
import type { PluginNodeRendererProps } from "@/lib/plugins/plugin-node-renderers";
import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { onPluginNodeGenerate } from "@/lib/plugins/plugin-node-bus";

import {
    MINIMAX_T2A_STATE_KEY,
    T2A_EMOTION_OPTIONS,
    T2A_PRESET_VOICES,
    createEmptyMinimaxT2AState,
    defaultT2AAudioSetting,
    defaultT2AVoiceSetting,
    type MinimaxT2ANodeState,
} from "./contracts";
import { cloneVoice, deleteVoice, designVoice, fileToBase64, listVoices, synthesizeT2A } from "./t2a-api";

function readState(node: CanvasNodeData): MinimaxT2ANodeState {
    const raw = (node.metadata?.pluginData?.[MINIMAX_T2A_STATE_KEY] ?? null) as Partial<MinimaxT2ANodeState> | null;
    const base = createEmptyMinimaxT2AState();
    if (!raw || typeof raw !== "object") return base;
    return {
        ...base,
        ...raw,
        tab: raw.tab === "voice-design" || raw.tab === "voice-clone" ? raw.tab : "synthesize",
        model: (["speech-02-hd", "speech-02", "speech-02-turbo", "speech-01-hd", "speech-01"] as const).includes(raw.model as never) ? raw.model as MinimaxT2ANodeState["model"] : base.model,
        voice: { ...defaultT2AVoiceSetting(), ...(raw.voice ?? {}) },
        audio: { ...defaultT2AAudioSetting(), ...(raw.audio ?? {}) },
        result: raw.result ?? null,
        voiceDesignTrialAudio: raw.voiceDesignTrialAudio ?? null,
        cloneVoices: Array.isArray(raw.cloneVoices) ? raw.cloneVoices : [],
    };
}

export function MinimaxT2ANodeContent({ node }: PluginNodeRendererProps) {
    const { message } = App.useApp();
    const { updateMetadata } = useCanvasNodeActions();
    const state = useMemo(() => readState(node), [node]);
    // 同上：合成音频期间出呼吸圈（判据取本插件自己的 `status`，不碰 `metadata.status`）。
    useNodeRunningStatus(updateMetadata, node.id, state.status === "loading");
    const persist = useCallback((patch: Partial<MinimaxT2ANodeState>) => {
        updateMetadata?.(node.id, {
            pluginData: {
                ...(node.metadata?.pluginData ?? {}),
                [MINIMAX_T2A_STATE_KEY]: { ...state, ...patch },
            },
        });
    }, [node, updateMetadata, state]);

    const [synthesizing, setSynthesizing] = useState(false);
    const [designing, setDesigning] = useState(false);
    const [cloning, setCloning] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [previewUrl, setPreviewUrl] = useState("");

    // 播放结果
    const playResult = useCallback(async (result: MinimaxT2ANodeState["result"]) => {
        if (!result) return;
        const url = result.storageKey ? (await cacheResourceObjectUrl(result.storageKey).catch(() => "")) || result.url : result.url;
        if (!url) return;
        setPreviewUrl(url);
        setTimeout(() => void audioRef.current?.play(), 0);
    }, []);

    // 音色克隆样本 base64（瞬时，不持久化进节点状态）
    const cloneSampleBase64Ref = useRef("");

    const runSynthesize = useCallback(async (textOverride?: string) => {
        const text = (textOverride ?? state.text ?? "").trim();
        if (!text) {
            message.warning("请输入要合成的文本");
            return;
        }
        setSynthesizing(true);
        persist({ status: "loading", errorDetails: undefined });
        try {
            const data = await synthesizeT2A({ text, model: state.model, voice: state.voice, audio: state.audio });
            const result = { storageKey: data.storageKey, url: data.url, durationMs: data.durationMs, mimeType: data.mimeType } as MinimaxT2ANodeState["result"];
            persist({ status: "success", result });
            void playResult(result);
        } catch (error) {
            persist({ status: "error", errorDetails: error instanceof Error ? error.message : "合成失败" });
        } finally {
            setSynthesizing(false);
        }
    }, [message, persist, playResult, state.model, state.text, state.voice, state.audio]);

    const runVoiceDesign = useCallback(async () => {
        if (!state.voiceDesignPrompt.trim()) {
            message.warning("请输入音色描述");
            return;
        }
        setDesigning(true);
        try {
            const data = await designVoice({ prompt: state.voiceDesignPrompt, previewText: state.voiceDesignPreviewText });
            const trialAudio = data.trialAudio as MinimaxT2ANodeState["result"];
            persist({ voiceDesignVoiceId: data.voiceId, voiceDesignTrialAudio: trialAudio });
            void playResult(trialAudio);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音色设计失败");
        } finally {
            setDesigning(false);
        }
    }, [message, persist, playResult, state.voiceDesignPrompt, state.voiceDesignPreviewText]);

    const handleCloneSampleFile = useCallback(async (file: File) => {
        try {
            const base64 = await fileToBase64(file);
            cloneSampleBase64Ref.current = base64;
            persist({ cloneSampleName: file.name, cloneStatus: "idle", cloneError: undefined });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "样本读取失败");
        }
    }, [message, persist]);

    const runVoiceClone = useCallback(async () => {
        if (!cloneSampleBase64Ref.current) {
            message.warning("请先选择真人声样本");
            return;
        }
        if (!state.cloneText.trim()) {
            message.warning("请输入样本音频实际朗读的文本（ASR 校验用）");
            return;
        }
        setCloning(true);
        persist({ cloneStatus: "loading", cloneError: undefined });
        try {
            await cloneVoice({
                sampleBase64: cloneSampleBase64Ref.current,
                sampleName: state.cloneSampleName ?? "voice_sample.mp3",
                text: state.cloneText,
                voiceId: state.cloneVoiceId || `my_voice_${Date.now().toString(36)}`,
                model: state.model,
            });
            const voices = await listVoices().catch(() => state.cloneVoices ?? []);
            persist({ cloneStatus: "success", cloneVoices: voices });
        } catch (error) {
            persist({ cloneStatus: "error", cloneError: error instanceof Error ? error.message : "克隆失败" });
        } finally {
            setCloning(false);
        }
    }, [message, persist, state.cloneText, state.cloneVoiceId, state.model, state.cloneVoices, state.cloneSampleName]);

    const refreshVoices = useCallback(async () => {
        try {
            const voices = await listVoices();
            persist({ cloneVoices: voices });
        } catch {
            // 忽略列表失败
        }
    }, [persist]);

    const handleDeleteVoice = useCallback(async (voiceId: string) => {
        try {
            await deleteVoice(voiceId);
            persist({ cloneVoices: state.cloneVoices.filter((v) => v.voiceId !== voiceId) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    }, [message, persist, state.cloneVoices]);

    const useDesignedVoice = useCallback(() => {
        if (!state.voiceDesignVoiceId) return;
        persist({ voice: { ...state.voice, voiceId: state.voiceDesignVoiceId }, tab: "synthesize" });
    }, [persist, state.voice, state.voiceDesignVoiceId]);

    // 订阅宿主系统提示词面板的「生成」按钮 → 用面板文本 + 节点自己的模型/声音设置合成
    useEffect(() => {
        return onPluginNodeGenerate((request) => {
            if (request.nodeId !== node.id) return;
            void runSynthesize(request.prompt);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, runSynthesize]);

    const voiceOptions = [
        ...T2A_PRESET_VOICES.map((v) => ({ value: v.id, label: v.label })),
        ...(state.cloneVoices ?? []).map((v) => ({ value: v.voiceId, label: `${v.name}（克隆）` })),
        ...(state.voiceDesignVoiceId ? [{ value: state.voiceDesignVoiceId, label: `${state.voiceDesignVoiceId}（设计）` }] : []),
    ];

    return (
        <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-2">
            {/* 标题栏 */}
            <div className="flex shrink-0 items-center justify-between gap-2">
                <span className="text-[var(--fs-label)] font-semibold">MiniMax T2A 语音合成</span>
                <div className="flex items-center gap-1">
                    {(["synthesize", "voice-design", "voice-clone"] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => persist({ tab })}
                            className={`rounded border px-1.5 py-0.5 text-[var(--fs-micro)] transition-colors ${state.tab === tab ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-border/60 hover:bg-white/5"}`}
                        >
                            {tab === "synthesize" ? "语音合成" : tab === "voice-design" ? "音色设计" : "音色克隆"}
                        </button>
                    ))}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                {state.tab === "synthesize" ? (
                    <div className="flex flex-col gap-2">
                        {/* 提示：文本在右侧系统面板输入 */}
                        <div className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2 py-1 text-[var(--fs-micro)] opacity-80">
                            在右侧系统面板输入文本后点「生成」；模型与声音/音频参数在本节点设置。
                        </div>
                        {/* 模型 */}
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--fs-micro)] opacity-70">模型</span>
                            <Select
                                size="small"
                                value={state.model}
                                style={{ width: 180 }}
                                options={[
                                    { value: "speech-02-hd", label: "speech-02-hd（推荐）" },
                                    { value: "speech-02", label: "speech-02" },
                                    { value: "speech-02-turbo", label: "speech-02-turbo（极速）" },
                                    { value: "speech-01-hd", label: "speech-01-hd" },
                                    { value: "speech-01", label: "speech-01" },
                                ]}
                                onChange={(model) => persist({ model })}
                            />
                        </div>
                        {/* 声音设置 */}
                        <div className="rounded border border-border/40 p-1.5">
                            <div className="mb-1 text-[var(--fs-micro)] font-semibold opacity-70">声音设置</div>
                            <div className="flex items-center gap-2">
                                <span className="w-8 text-[var(--fs-tiny)] opacity-70">音色</span>
                                <Select
                                    size="small"
                                    style={{ flex: 1 }}
                                    mode="tags"
                                    maxCount={1}
                                    showSearch
                                    filterOption={(input, option) =>
                                        String(option?.label ?? "").toLowerCase().includes(input.toLowerCase()) ||
                                        String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
                                    }
                                    value={state.voice.voiceId ? [state.voice.voiceId] : []}
                                    options={voiceOptions}
                                    placeholder="搜索或输入音色 ID"
                                    onChange={(values) => persist({ voice: { ...state.voice, voiceId: values[values.length - 1] ?? "" } })}
                                />
                            </div>
                            <SettingSlider label="语速" value={state.voice.speed} min={0.5} max={2} step={0.1} onChange={(speed) => persist({ voice: { ...state.voice, speed } })} />
                            <SettingSlider label="音量" value={state.voice.vol} min={0.1} max={3} step={0.1} onChange={(vol) => persist({ voice: { ...state.voice, vol } })} />
                            <SettingSlider label="音调" value={state.voice.pitch} min={-12} max={12} step={1} onChange={(pitch) => persist({ voice: { ...state.voice, pitch } })} />
                            <div className="flex items-center gap-2">
                                <span className="w-8 text-[var(--fs-tiny)] opacity-70">情感</span>
                                <Select
                                    size="small"
                                    style={{ flex: 1 }}
                                    value={state.voice.emotion || undefined}
                                    placeholder="自然"
                                    allowClear
                                    options={T2A_EMOTION_OPTIONS.map((e) => ({ value: e, label: e }))}
                                    onChange={(emotion) => persist({ voice: { ...state.voice, emotion: emotion ?? "" } })}
                                />
                            </div>
                        </div>
                        {/* 音频设置 */}
                        <div className="rounded border border-border/40 p-1.5">
                            <div className="mb-1 text-[var(--fs-micro)] font-semibold opacity-70">音频设置</div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[var(--fs-tiny)] opacity-70">采样率</span>
                                <Select size="small" value={state.audio.sampleRate} style={{ width: 100 }} options={[8000, 16000, 32000, 44100, 48000].map((v) => ({ value: v, label: `${v}` }))} onChange={(sampleRate) => persist({ audio: { ...state.audio, sampleRate } })} />
                                <span className="text-[var(--fs-tiny)] opacity-70">格式</span>
                                <Select size="small" value={state.audio.format} style={{ width: 80 }} options={["mp3", "wav", "pcm"].map((v) => ({ value: v, label: v }))} onChange={(format) => persist({ audio: { ...state.audio, format } })} />
                                <span className="text-[var(--fs-tiny)] opacity-70">声道</span>
                                <Select size="small" value={state.audio.channel} style={{ width: 70 }} options={[{ value: 1, label: "单" }, { value: 2, label: "双" }]} onChange={(channel) => persist({ audio: { ...state.audio, channel } })} />
                            </div>
                        </div>
                        {/* 操作 */}
                        <div className="flex items-center gap-1.5">
                            {state.result ? (
                                <>
                                    <Button size="small" icon={<Play className="size-3" />} onClick={() => void playResult(state.result)}>
                                        试听
                                    </Button>
                                    <Button size="small" icon={<Download className="size-3" />} href={previewUrl || state.result.url} target="_blank" rel="noreferrer">
                                        下载
                                    </Button>
                                </>
                            ) : null}
                        </div>
                        {/* 状态 + 播放器 */}
                        {state.status === "loading" ? <Tag color="blue">合成中…</Tag> : null}
                        {state.status === "error" ? <Tag color="red">{state.errorDetails ?? "合成失败"}</Tag> : null}
                        {state.status === "success" && state.result ? (
                            <Tag color="green">已生成 {state.result.durationMs ? `${(state.result.durationMs / 1000).toFixed(1)}s` : ""}</Tag>
                        ) : null}
                        {previewUrl ? (
                            <audio ref={audioRef} src={previewUrl} controls className="w-full" />
                        ) : null}
                    </div>
                ) : state.tab === "voice-design" ? (
                    <div className="flex flex-col gap-2">
                        <div>
                            <div className="mb-1 text-[var(--fs-micro)] opacity-70">音色描述（≤80 字，只描述声音特征）</div>
                            <Input.TextArea value={state.voiceDesignPrompt} onChange={(e) => persist({ voiceDesignPrompt: e.target.value })} placeholder="低沉浑厚、中气十足、略带金属回声的男性声线" autoSize={{ minRows: 2, maxRows: 4 }} />
                            <div className="mt-0.5 text-right text-[var(--fs-tiny)] opacity-60">{state.voiceDesignPrompt.length}/80</div>
                        </div>
                        <div>
                            <div className="mb-1 text-[var(--fs-micro)] opacity-70">试听文本（≤500 字）</div>
                            <Input.TextArea value={state.voiceDesignPreviewText} onChange={(e) => persist({ voiceDesignPreviewText: e.target.value })} autoSize={{ minRows: 2, maxRows: 3 }} />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button size="small" type="primary" icon={<AudioLines className="size-3" />} loading={designing} onClick={runVoiceDesign}>
                                {designing ? "生成中…" : "生成试听音色"}
                            </Button>
                            {state.voiceDesignTrialAudio ? (
                                <>
                                    <Button size="small" icon={<Play className="size-3" />} onClick={() => void playResult(state.voiceDesignTrialAudio)}>
                                        试听
                                    </Button>
                                    <Button size="small" type="primary" ghost icon={<Wand2 className="size-3" />} onClick={useDesignedVoice}>
                                        用此音色合成
                                    </Button>
                                </>
                            ) : null}
                        </div>
                        {state.voiceDesignVoiceId ? <Tag color="green">音色已生成：{state.voiceDesignVoiceId}</Tag> : null}
                        {previewUrl ? <audio ref={audioRef} src={previewUrl} controls className="w-full" /> : null}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Button size="small" icon={<Upload className="size-3" />} onClick={() => document.getElementById("minimax-t2a-sample")?.click()}>
                                {state.cloneSampleName || "上传真人声样本"}
                            </Button>
                            <input
                                id="minimax-t2a-sample"
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleCloneSampleFile(file);
                                    e.target.value = "";
                                }}
                            />
                            <span className="text-[var(--fs-tiny)] opacity-60">≥6 秒真人声，mp3/wav</span>
                        </div>
                        <div>
                            <div className="mb-1 text-[var(--fs-micro)] opacity-70">样本音频实际朗读的文本（ASR 相似度校验，必须一致）</div>
                            <Input.TextArea value={state.cloneText} onChange={(e) => persist({ cloneText: e.target.value })} placeholder="输入样本音频里实际朗读的内容" autoSize={{ minRows: 2, maxRows: 4 }} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--fs-tiny)] opacity-70">音色ID</span>
                            <Input size="small" value={state.cloneVoiceId} onChange={(e) => persist({ cloneVoiceId: e.target.value })} style={{ width: 180 }} placeholder="my_voice_001" />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button size="small" type="primary" icon={<AudioLines className="size-3" />} loading={cloning} onClick={runVoiceClone}>
                                {cloning ? "克隆中…" : "开始克隆"}
                            </Button>
                            <Button size="small" icon={<RefreshCw className="size-3" />} onClick={() => void refreshVoices()}>
                                刷新列表
                            </Button>
                        </div>
                        {state.cloneStatus === "success" ? <Tag color="green">克隆成功，可在语音合成里选用</Tag> : null}
                        {state.cloneStatus === "error" ? <Tag color="red">{state.cloneError ?? "克隆失败"}</Tag> : null}
                        <div className="rounded border border-border/40 p-1.5">
                            <div className="mb-1 text-[var(--fs-micro)] font-semibold opacity-70">我的克隆音色</div>
                            {(state.cloneVoices ?? []).length === 0 ? (
                                <div className="text-[var(--fs-tiny)] opacity-50">暂无克隆音色</div>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {(state.cloneVoices ?? []).map((v) => (
                                        <div key={v.voiceId} className="flex items-center justify-between gap-1">
                                            <span className="text-[var(--fs-micro)]">{v.name || v.voiceId}</span>
                                            <div className="flex items-center gap-1">
                                                <Button size="small" type="text" icon={<Play className="size-3" />} title="选用并合成" onClick={() => persist({ voice: { ...state.voice, voiceId: v.voiceId }, tab: "synthesize" })} />
                                                <Button size="small" type="text" danger icon={<Download className="size-3" />} title="删除" onClick={() => void handleDeleteVoice(v.voiceId)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/** 设置滑块行。 */
function SettingSlider({ label, value, min, max, step, onChange }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-8 text-[var(--fs-tiny)] opacity-70">{label}</span>
            <Slider min={min} max={max} step={step} value={value} style={{ flex: 1 }} onChange={onChange} />
            <span className="w-10 text-right text-[var(--fs-tiny)] opacity-70">{value}</span>
        </div>
    );
}
