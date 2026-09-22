import { useRef, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Radio } from "antd";
import { ExternalLink, Upload } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Live2DAvatar } from "@/components/canvas/live2d-avatar";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { agentCopy, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { live2DModelURL, uploadLive2D } from "@/services/api/appearance";

export function CanvasAppearanceEditor({ value, onChange, disabled, onUploading }: { value: CanvasAppearance; onChange: (value: CanvasAppearance) => void; disabled: boolean; onUploading: (value: boolean) => void }) {
    const { message } = App.useApp();
    const reducedMotion = useReducedMotion() ?? false;
    const input = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [readyURL, setReadyURL] = useState("");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const url = value.live2dResourceId ? live2DModelURL(value.live2dResourceId, value.live2dEntry, true) : "";
    const change = (patch: Partial<CanvasAppearance>) => onChange({ ...value, ...patch });
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
    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <div>
                <h3 className="mb-3 font-semibold">Agent 身份与文案</h3>
                <p className="mb-4 text-sm text-foreground/60">独立于站点品牌。文案可使用 {"{agentName}"} 引用助手名称；这里只配置展示文字，不修改工具权限。</p>
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
                    onChange={(event) => change({ avatarType: event.target.value })}
                    options={[
                        { label: "默认动态球", value: "orb" },
                        { label: "Live2D", value: "live2d", disabled: !url || readyURL !== url },
                    ]}
                />
                <p className="text-sm text-foreground/60">上传有授权的 Cubism 3/4 运行时 ZIP：一个 model3.json、moc3、PNG 纹理及可选动作/表情 JSON。首期不支持音频、旧版模型和编辑工程。模型会发送到浏览器，无法保证防下载。</p>
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
                            fallback={<FluidOrb size={62} color="#7164f6" />}
                            onReady={() => {
                                setReadyURL(url);
                                setError("");
                            }}
                            onError={(reason) => {
                                setReadyURL("");
                                setError(reason);
                            }}
                        />
                    ) : (
                        <FluidOrb size={62} color="#7164f6" />
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
