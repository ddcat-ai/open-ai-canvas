import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Radio, Select } from "antd";
import { ExternalLink, Upload } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Live2DAvatar } from "@/components/canvas/live2d-avatar";
import { FluidOrb } from "@/components/ui/fluid-orb";
import {
    AGENT_AVATAR_STATES,
    DEFAULT_AGENT_AVATAR_CLIP_STATES,
    agentAvatarClipForState,
    agentCopy,
    isAgentAvatarBundleManifest,
    suggestedAgentAvatarClipStates,
    type AgentAvatarBundleManifest,
    type AgentAvatarState,
    type CanvasAppearance,
} from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL, live2DModelURL, uploadAgentAvatarBundle, uploadLive2D } from "@/services/api/appearance";
import { AgentAvatarVideo } from "@/components/canvas/agent-avatar-video";

export function CanvasAppearanceEditor({ value, onChange, disabled, onUploading }: { value: CanvasAppearance; onChange: (value: CanvasAppearance) => void; disabled: boolean; onUploading: (value: boolean) => void }) {
    const { message } = App.useApp();
    const reducedMotion = useReducedMotion() ?? false;
    const input = useRef<HTMLInputElement>(null);
    const bundleInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [readyURL, setReadyURL] = useState("");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [bundleManifest, setBundleManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [bundleLoading, setBundleLoading] = useState(false);
    const [bundleError, setBundleError] = useState("");
    const [selectedAvatarState, setSelectedAvatarState] = useState<AgentAvatarState>("idle");
    const url = value.live2dResourceId ? live2DModelURL(value.live2dResourceId, value.live2dEntry, true) : "";
    const bundleID = value.avatarBundleResourceId;
    const bundleManifestURL = bundleID ? agentAvatarBundleFileURL(bundleID, "avatar.json", true) : "/doll/avatar.json";
    const previewClip = bundleManifest ? agentAvatarClipForState(value, selectedAvatarState, bundleManifest) : "";
    const previewFile = bundleManifest?.clips[previewClip] || "";
    const previewBundleURL = previewFile ? (bundleID ? agentAvatarBundleFileURL(bundleID, previewFile, true) : `/doll/${encodeURIComponent(previewFile)}`) : "";
    const change = (patch: Partial<CanvasAppearance>) => onChange({ ...value, ...patch });
    useEffect(() => {
        if (value.avatarType !== "bundle") return;
        const controller = new AbortController();
        setBundleLoading(true);
        setBundleError("");
        setBundleManifest(null);
        void (async () => {
            try {
                const response = await fetch(bundleManifestURL, { credentials: "include", cache: "no-store", signal: controller.signal });
                if (!response.ok) throw new Error(`读取动画包失败（HTTP ${response.status}）`);
                const manifest: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(manifest)) throw new Error("avatar.json 格式无效");
                setBundleManifest(manifest);
            } catch (cause) {
                if (!controller.signal.aborted) setBundleError(cause instanceof Error ? cause.message : "无法读取 Agent 动画包");
            } finally {
                if (!controller.signal.aborted) setBundleLoading(false);
            }
        })();
        return () => controller.abort();
    }, [value.avatarType, bundleManifestURL, attempt]);
    async function upload(file?: File) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size > 128 * 1024 * 1024) {
            message.error("请选择不超过 128 MiB 的 Live2D ZIP");
            return;
        }
        setUploading(true);
        onUploading(true);
        setError("");
        try {
            const model = await uploadLive2D(file);
            setReadyURL("");
            change({ live2dResourceId: model.resourceId, live2dEntry: model.entry, avatarType: "orb" });
            message.success("导入成功，请预览后选择 Live2D，并点击页面顶部保存");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "模型导入失败");
        } finally {
            setUploading(false);
            onUploading(false);
        }
    }
    async function uploadBundle(file?: File) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size > 128 * 1024 * 1024) {
            message.error("请选择不超过 128 MiB 的 Agent 动画 ZIP");
            return;
        }
        setUploading(true);
        onUploading(true);
        setBundleError("");
        try {
            const bundle = await uploadAgentAvatarBundle(file);
            setBundleManifest(bundle.manifest);
            change({
                avatarType: "bundle",
                avatarBundleResourceId: bundle.resourceId,
                avatarClipStates: suggestedAgentAvatarClipStates(bundle.manifest),
            });
            setSelectedAvatarState("idle");
            message.success("动画包已导入，请检查状态映射并点击页面顶部保存");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "Agent 动画包导入失败");
        } finally {
            setUploading(false);
            onUploading(false);
        }
    }
    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div>
                <h3 className="mb-3 font-semibold">Agent 身份与文案</h3>
                <p className="mb-4 text-sm text-foreground/60">独立于站点品牌。助手名称同步用于界面文案和对话中的自我介绍；文案可使用 {"{agentName}"} 引用名称，不修改工具权限。</p>
                <Form layout="vertical" disabled={disabled || uploading}>
                    {(
                        [
                            ["agentName", "助手名称", 24],
                            ["launcherLabel", "悬浮入口文字（可留空）", 24],
                            ["panelTitle", "对话面板标题", 40],
                            ["welcomeTitle", "欢迎标题", 100],
                            ["welcomeDescription", "欢迎说明", 200],
                            ["inputPlaceholder", "输入框提示", 160],
                        ] as const
                    ).map(([key, label, max]) => (
                        <Form.Item key={key} label={label}>
                            <Input value={value[key]} maxLength={max} showCount onChange={(event) => change({ [key]: event.target.value })} />
                        </Form.Item>
                    ))}
                </Form>
            </div>
            <div className="grid content-start gap-4">
                <h3 className="font-semibold">Agent 形象</h3>
                <Radio.Group
                    value={value.avatarType}
                    disabled={disabled || uploading}
                    options={[
                        { label: "默认动态球", value: "orb" },
                        { label: "Live2D", value: "live2d", disabled: !url || readyURL !== url },
                        { label: "状态动画包", value: "bundle" },
                    ]}
                    onChange={(event) => {
                        const type = event.target.value;
                        change(type === "bundle" ? { avatarType: type, avatarClipStates: value.avatarClipStates || DEFAULT_AGENT_AVATAR_CLIP_STATES } : { avatarType: type });
                    }}
                />
                {value.avatarType === "live2d" ? (
                    <p className="text-sm text-foreground/60">上传有授权的 Cubism 3/4 运行时 ZIP：一个 model3.json、moc3、PNG 纹理及可选动作/表情 JSON。首期不支持音频、旧版模型和编辑工程。模型会发送到浏览器，无法保证防下载。</p>
                ) : null}
                {value.avatarType === "bundle" ? (
                    <div className="grid gap-3">
                        <input
                            ref={bundleInput}
                            type="file"
                            accept=".zip,application/zip"
                            className="hidden"
                            onChange={(event) => {
                                void uploadBundle(event.target.files?.[0]);
                                event.currentTarget.value = "";
                            }}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button icon={<Upload className="size-4" />} disabled={disabled || uploading} loading={uploading} onClick={() => bundleInput.current?.click()}>
                                导入状态动画包 ZIP（最大 128 MiB）
                            </Button>
                            {value.avatarBundleResourceId ? (
                                <Button
                                    disabled={disabled || uploading}
                                    onClick={() => {
                                        change({
                                            avatarType: "bundle",
                                            avatarBundleResourceId: "",
                                            avatarClipStates: DEFAULT_AGENT_AVATAR_CLIP_STATES,
                                        });
                                        setBundleError("");
                                    }}
                                >
                                    恢复内置动画包
                                </Button>
                            ) : null}
                        </div>
                        <div className="grid gap-3 border-t border-border pt-3">
                            <Radio.Group
                                className="flex flex-wrap"
                                optionType="button"
                                value={selectedAvatarState}
                                disabled={disabled || uploading}
                                options={AGENT_AVATAR_STATES.map((item) => ({ label: item.label, value: item.id }))}
                                onChange={(event) => setSelectedAvatarState(event.target.value)}
                            />
                            <label className="grid gap-1 text-sm">
                                {AGENT_AVATAR_STATES.find((item) => item.id === selectedAvatarState)?.label}动画
                                <Select
                                    aria-label="当前状态动画"
                                    value={previewClip || undefined}
                                    disabled={disabled || uploading || !bundleManifest}
                                    loading={bundleLoading}
                                    options={Object.entries(bundleManifest?.clips ?? {}).map(([clip, file]) => ({ label: `${clip} · ${file}`, value: clip }))}
                                    onChange={(clip) =>
                                        change({
                                            avatarType: "bundle",
                                            avatarClipStates: { ...value.avatarClipStates, [selectedAvatarState]: clip },
                                        })
                                    }
                                />
                            </label>
                        </div>
                        {bundleManifest ? (
                            <p className="text-xs text-foreground/60">
                                {Object.keys(bundleManifest.clips).length} 个动画 · {bundleManifest.width} × {bundleManifest.height}
                            </p>
                        ) : null}
                        {bundleError ? (
                            <Alert
                                type="warning"
                                showIcon
                                title="动画包预览失败"
                                description={bundleError}
                                action={
                                    <Button size="small" onClick={() => setAttempt((current) => current + 1)}>
                                        重试
                                    </Button>
                                }
                            />
                        ) : null}
                    </div>
                ) : null}

                <div className="grid gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="text-foreground/60">参考资料</span>
                        <a href="https://www.live2d.com/en/learn/sample/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                            官方示例模型库
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">（在新标签页打开）</span>
                        </a>
                        <a href="https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                            Cubism Web SDK 文档
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">（在新标签页打开）</span>
                        </a>
                    </div>
                    <p className="text-xs text-foreground/60">下载前请确认素材授权；官方原始包需按上述要求整理为运行时 ZIP，不能直接整包导入。</p>
                </div>
                <input
                    ref={input}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(event) => {
                        void upload(event.target.files?.[0]);
                        event.currentTarget.value = "";
                    }}
                />
                <div className="flex flex-wrap gap-2">
                    <Button icon={<Upload className="size-4" />} loading={uploading} disabled={disabled} onClick={() => input.current?.click()}>
                        导入 Live2D 模型（最大 128 MiB）
                    </Button>
                    {url ? (
                        <Button
                            disabled={disabled || uploading}
                            onClick={() => {
                                change({ avatarType: "orb", live2dResourceId: "", live2dEntry: "" });
                                setError("");
                            }}
                        >
                            移除模型引用
                        </Button>
                    ) : null}
                </div>
                <label className="flex items-center gap-3 text-sm">
                    形象高度
                    <InputNumber aria-label="形象高度" min={120} max={360} value={value.avatarHeight} disabled={disabled || uploading} onChange={(height) => height !== null && change({ avatarHeight: height })} />
                    px
                </label>
                <div className="grid justify-items-center gap-3 rounded-xl border border-border bg-background p-5" aria-label="Agent 形象预览">
                    {url ? (
                        <Live2DAvatar
                            key={`${url}-${attempt}`}
                            url={url}
                            width={Math.round(value.avatarHeight * 0.75)}
                            height={value.avatarHeight}
                            reducedMotion={reducedMotion}
                            fallback={<FluidOrb size={60} color="#7164f6" />}
                            onReady={() => {
                                setReadyURL(url);
                                setError("");
                            }}
                            onError={(reason) => {
                                setReadyURL("");
                                setError(reason);
                            }}
                        />
                    ) : value.avatarType === "bundle" && previewBundleURL && bundleManifest ? (
                        <div
                            className="relative mx-auto overflow-hidden"
                            style={{
                                width: Math.round(bundleManifest.width * Math.min(1, 220 / Math.max(bundleManifest.width, bundleManifest.height))),
                                height: Math.round(bundleManifest.height * Math.min(1, 220 / Math.max(bundleManifest.width, bundleManifest.height))),
                            }}
                        >
                            <AgentAvatarVideo src={previewBundleURL} loop={!["completed", "failed"].includes(selectedAvatarState)} />
                        </div>
                    ) : (
                        <FluidOrb size={60} color="#7164f6" />
                    )}
                    <strong>{agentCopy(value.welcomeTitle, value.agentName)}</strong>
                    <p className="text-sm text-foreground/60">{agentCopy(value.welcomeDescription, value.agentName)}</p>
                    {url ? <small>{readyURL === url ? "预览已就绪，可选择 Live2D 并保存启用" : "等待模型预览就绪"}</small> : null}
                </div>
                {error ? (
                    <Alert
                        type="warning"
                        showIcon
                        title="Live2D 暂不可用"
                        description={error}
                        action={
                            <Button
                                size="small"
                                onClick={() => {
                                    setError("");
                                    setAttempt((n) => n + 1);
                                }}
                            >
                                重试
                            </Button>
                        }
                    />
                ) : null}
                <p className="text-xs text-foreground/60">项目已内置 Cubism Core，无需另行安装。使用前仍需确认 Live2D SDK 及模型素材的适用授权。未启用的导入包可在资源管理中清理。</p>
            </div>
        </div>
    );
}
