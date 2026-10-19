import { useRef, useState } from "react";
import { Alert, App, Button, Form, Input, Radio, Slider, Switch } from "antd";
import { ArrowDown, ArrowUp, ExternalLink, Trash2, Upload } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Live2DAvatar } from "@/components/canvas/live2d-avatar";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { agentCopy, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { live2DModelURL, uploadLive2D, type PetAppearance } from "@/services/api/appearance";
import { PetCatalogLibrary } from "./pet-catalog-library";
import "./pet-catalog-editor.css";
import { SpritePetEditor } from "./sprite-pet-editor";
import { validateSpritePet } from "@/lib/canvas/sprite-pet";
import { AvatarBundleEditor } from "./avatar-bundle-editor";

export function CanvasAppearanceEditor({
    value: globalValue,
    onChange,
    catalog,
    onCatalogChange,
    disabled,
    onUploading,
}: {
    value: CanvasAppearance;
    onChange: (value: CanvasAppearance) => void;
    catalog: PetAppearance[];
    onCatalogChange: (value: PetAppearance[]) => void;
    disabled: boolean;
    onUploading: (value: boolean) => void;
}) {
    const [selectedId, setSelectedId] = useState(globalValue.defaultPetId || catalog[0]?.id || "");
    const selected = catalog.find((p) => p.id === selectedId) || catalog[0];
    const value = selected ? { ...globalValue, ...selected } : globalValue;
    const { message } = App.useApp();
    const reducedMotion = useReducedMotion() ?? false;
    const input = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [readyURL, setReadyURL] = useState("");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [spriteReady, setSpriteReady] = useState("");
    const url = value.live2dResourceId ? live2DModelURL(value.live2dResourceId, value.live2dEntry, true) : "";
    const change = (patch: Partial<CanvasAppearance>) => {
        const modelKeys = ["avatarType", "avatarHeight", "live2dResourceId", "live2dEntry", "spriteResourceId", "sprite", "avatarBundleResourceId", "avatarClipStates"];
        if (Object.keys(patch).every((k) => !modelKeys.includes(k))) {
            onChange({ ...globalValue, ...patch });
            return;
        }
        if (selected) onCatalogChange(catalog.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)));
        if (!selected || selected.id === globalValue.defaultPetId) onChange({ ...globalValue, ...patch });
    };
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
        <div className="pet-admin-workspace">
            <details className="pet-admin-identity">
                <summary>助手名称与文案</summary>
                <div className="pet-admin-identity-fields">
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
            </details>
            <PetCatalogLibrary
                catalog={catalog}
                selectedId={selected?.id || ""}
                defaultId={globalValue.defaultPetId}
                disabled={disabled || uploading}
                onChange={onCatalogChange}
                onUploading={onUploading}
                onSelect={(id) => {
                    setSelectedId(id);
                    setError("");
                }}
            />
            <section className="pet-admin-detail" aria-label="形象详情" key={selected?.id}>
                <div className="pet-admin-detail-title">
                    <h3>{selected?.name || "形象设置"}</h3>
                    <span>当前编辑</span>
                </div>
                {selected ? (
                    <div className="grid gap-3" aria-label="编辑形象">
                        <label className="grid gap-1 text-sm">
                            形象名称
                            <Input aria-label="形象名称" value={selected.name} maxLength={40} disabled={disabled} onChange={(e) => onCatalogChange(catalog.map((p) => (p.id === selected.id ? { ...p, name: e.target.value } : p)))} />
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            <Switch
                                aria-label="发布给用户选择"
                                checked={selected.published}
                                disabled={disabled || selected.id === globalValue.defaultPetId}
                                onChange={(published) => onCatalogChange(catalog.map((p) => (p.id === selected.id ? { ...p, published } : p)))}
                            />
                            <span className="text-sm">发布给用户选择</span>
                            <Button disabled={disabled || !selected.published || selected.id === globalValue.defaultPetId} onClick={() => onChange({ ...globalValue, ...selected, defaultPetId: selected.id })}>
                                设为系统默认
                            </Button>
                            <Button
                                aria-label="形象前移"
                                title="前移"
                                icon={<ArrowUp size={16} aria-hidden />}
                                disabled={disabled || catalog[0]?.id === selected.id}
                                onClick={() => {
                                    const next = [...catalog],
                                        index = next.findIndex((p) => p.id === selected.id);
                                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                    onCatalogChange(next);
                                }}
                            />
                            <Button
                                aria-label="形象后移"
                                title="后移"
                                icon={<ArrowDown size={16} aria-hidden />}
                                disabled={disabled || catalog.at(-1)?.id === selected.id}
                                onClick={() => {
                                    const next = [...catalog],
                                        index = next.findIndex((p) => p.id === selected.id);
                                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                    onCatalogChange(next);
                                }}
                            />
                            <Button
                                danger
                                aria-label="移除形象"
                                title="移除形象"
                                icon={<Trash2 size={16} aria-hidden />}
                                disabled={disabled || selected.id === globalValue.defaultPetId}
                                onClick={() => {
                                    onCatalogChange(catalog.filter((p) => p.id !== selected.id));
                                    setSelectedId(globalValue.defaultPetId || "");
                                }}
                            />
                        </div>
                    </div>
                ) : null}
                <Radio.Group
                    value={value.avatarType}
                    disabled={disabled || uploading}
                    onChange={(event) => change({ avatarType: event.target.value })}
                    options={[
                        { label: "默认动态球", value: "orb" },
                        { label: "状态动画包", value: "bundle" },
                        { label: "Live2D", value: "live2d", disabled: !url || readyURL !== url },
                        { label: "精灵宠物", value: "sprite", disabled: !value.sprite || Boolean(validateSpritePet(value.sprite)) || spriteReady !== value.spriteResourceId },
                    ]}
                />
                <div className="pet-admin-model-content">
                    {value.avatarType === "bundle" ? <AvatarBundleEditor key={selected?.id} value={value} onChange={change} disabled={disabled || uploading} onUploading={onUploading} /> : null}
                    {value.avatarType === "sprite" || value.sprite ? (
                        <SpritePetEditor key={selected?.id} value={value} onChange={change} disabled={disabled || uploading} onUploading={onUploading} onReady={setSpriteReady} />
                    ) : (
                        <details className="pet-admin-import-details">
                            <summary>导入精灵素材</summary>
                            <SpritePetEditor key={selected?.id} value={value} onChange={change} disabled={disabled || uploading} onUploading={onUploading} onReady={setSpriteReady} />
                        </details>
                    )}
                    <details className="pet-admin-import-details" open={value.avatarType === "live2d"}>
                        <summary className="cursor-pointer text-sm font-medium">Live2D 模型设置</summary>
                        <div className="mt-3 grid gap-4">
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
                        </div>
                    </details>
                </div>
                <div className="grid gap-1 text-sm">
                    <label id="pet-admin-height-label">
                        默认大小 <output>{value.avatarType === "orb" ? `${Math.round((value.avatarHeight / 220) * 100)}%` : `${value.avatarHeight} px`}</output>
                    </label>
                    <Slider ariaLabelledByForHandle="pet-admin-height-label" min={120} max={360} step={5} value={value.avatarHeight} disabled={disabled || uploading} onChange={(height) => change({ avatarHeight: height })} />
                    <div className="flex justify-between text-xs text-foreground/60">
                        <span>{value.avatarType === "orb" ? "小" : "120 px"}</span>
                        <span>{value.avatarType === "orb" ? "大" : "360 px"}</span>
                    </div>
                </div>
                {value.avatarType !== "sprite" ? (
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
                        ) : (
                            <FluidOrb size={Math.round((60 * value.avatarHeight) / 220)} color="#7164f6" />
                        )}
                        <strong>{agentCopy(value.welcomeTitle, value.agentName)}</strong>
                        <p className="text-sm text-foreground/60">{agentCopy(value.welcomeDescription, value.agentName)}</p>
                        {url ? <small>{readyURL === url ? "预览已就绪，可选择 Live2D 并保存启用" : "等待模型预览就绪"}</small> : null}
                    </div>
                ) : null}
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
            </section>
        </div>
    );
}
