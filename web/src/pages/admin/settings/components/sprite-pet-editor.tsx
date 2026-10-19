import { useRef, useState } from "react";
import { Alert, App, Button, Input, InputNumber, Select, Switch } from "antd";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { SpriteAvatar } from "@/components/canvas/sprite-avatar";
import type { CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { SPRITE_BINDING_LABELS, validateSpritePet, type SpriteAction, type SpriteBinding, type SpritePet } from "@/lib/canvas/sprite-pet";
import { spriteImageURL, uploadSpritePet } from "@/services/api/appearance";
import { zipSync, strToU8 } from "fflate";

export function SpritePetEditor({
    value,
    onChange,
    disabled,
    onUploading,
    onReady,
}: {
    value: CanvasAppearance;
    onChange: (patch: Partial<CanvasAppearance>) => void;
    disabled: boolean;
    onUploading: (busy: boolean) => void;
    onReady: (id: string) => void;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const atlasInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false),
        [action, setAction] = useState(""),
        [attempt, setAttempt] = useState(0),
        [imageError, setImageError] = useState("");
    const pet = value.sprite;
    const invalid = pet ? validateSpritePet(pet) : "";
    const change = (patch: Partial<SpritePet>) => pet && onChange({ sprite: { ...pet, ...patch } });
    async function upload(file?: File) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size > 16 * 1024 * 1024) {
            message.error("请选择不超过 16 MiB 的精灵宠物 ZIP");
            return;
        }
        setUploading(true);
        onUploading(true);
        try {
            const imported = await uploadSpritePet(file);
            onReady("");
            setAction("");
            setImageError("");
            onChange({ spriteResourceId: imported.resourceId, sprite: imported.config, avatarType: "orb" });
            message.success("宠物已导入，预览就绪后选择精灵宠物并保存");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "宠物导入失败");
        } finally {
            setUploading(false);
            onUploading(false);
        }
    }
    const updateAction = (index: number, patch: Partial<SpriteAction>) => pet && change({ actions: pet.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
    async function uploadAtlas(file?: File) {
        if (!file) return;
        if (!/\.(png|webp)$/i.test(file.name) || file.size > 15 * 1024 * 1024) {
            message.error("请选择不超过 15 MiB 的 PNG / WebP 图集");
            return;
        }
        try {
            const bitmap = await createImageBitmap(file),
                width = bitmap.width,
                height = bitmap.height;
            bitmap.close();
            if (width < 8 || height < 8 || width > 4096 || height > 4096) {
                message.error("图集宽高须为 8–4096px");
                return;
            }
            const name = file.name.toLowerCase().endsWith(".png") ? "atlas.png" : "atlas.webp";
            const config: SpritePet = {
                displayName: file.name.replace(/\.[^.]+$/, ""),
                spritesheetPath: name,
                atlasWidth: width,
                atlasHeight: height,
                frameWidth: width,
                frameHeight: height,
                neutralFrame: 0,
                lookStartFrame: -1,
                lookDirections: 0,
                speed: 1,
                sleepAfterSeconds: 0,
                author: "",
                source: "",
                license: "",
                actions: [{ id: "idle", label: "待机", row: 0, start: 0, frames: 1, fps: 4, loop: true }],
                bindings: { idle: "idle", working: "", waiting: "", failed: "", completed: "", moveLeft: "", moveRight: "", hover: "", greeting: "", sleep: "", wake: "" },
            };
            const bytes = zipSync({ "pet.json": strToU8(JSON.stringify({ displayName: config.displayName, spritesheetPath: name, yinghui: config })), [name]: new Uint8Array(await file.arrayBuffer()) }, { level: 0 });
            await upload(new File([bytes as BlobPart], "custom-pet.zip", { type: "application/zip" }));
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "图集无法读取");
        }
    }
    return (
        <section className="grid gap-4 rounded-xl border border-border p-4" aria-label="精灵宠物设置">
            <div>
                <h4 className="font-semibold">精灵宠物</h4>
                <p className="mt-1 text-sm text-foreground/60">导入角色后自由配置动作和状态。支持 Codex v1/v2；自定义 PNG / WebP 图集通过 pet.json 描述，不限定角色或画风。</p>
            </div>
            <input
                ref={input}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.currentTarget.value = "";
                }}
            />
            <input
                ref={atlasInput}
                type="file"
                accept=".png,.webp,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                    void uploadAtlas(e.target.files?.[0]);
                    e.currentTarget.value = "";
                }}
            />
            <div className="flex flex-wrap gap-2">
                <Button icon={<Upload className="size-4" />} loading={uploading} disabled={disabled} onClick={() => input.current?.click()}>
                    导入精灵宠物 ZIP（最大 16 MiB）
                </Button>
                <Button disabled={disabled || uploading} onClick={() => atlasInput.current?.click()}>
                    导入自定义图集图片
                </Button>
                {pet ? (
                    <Button
                        disabled={disabled}
                        onClick={() => {
                            onChange({ sprite: undefined, spriteResourceId: "", avatarType: value.avatarType === "sprite" ? "orb" : value.avatarType });
                            onReady("");
                        }}
                    >
                        移除宠物引用
                    </Button>
                ) : null}
            </div>
            {pet && value.spriteResourceId ? (
                <>
                    <label className="grid gap-1 text-sm">
                        宠物显示名称
                        <Input aria-label="宠物显示名称" maxLength={80} value={pet.displayName} disabled={disabled} onChange={(e) => change({ displayName: e.target.value })} />
                    </label>
                    <div className="grid justify-items-center gap-3 overflow-hidden rounded-lg border border-border bg-background p-3" aria-label="精灵宠物预览">
                        {!invalid ? (
                            <SpriteAvatar
                                key={`${value.spriteResourceId}-${attempt}`}
                                pet={pet}
                                url={spriteImageURL(value.spriteResourceId, true)}
                                height={Math.min(value.avatarHeight, 240, (260 * pet.frameHeight) / pet.frameWidth)}
                                previewAction={action || pet.bindings.idle}
                                onReady={() => {
                                    setImageError("");
                                    onReady(value.spriteResourceId!);
                                }}
                                onError={(reason) => {
                                    setImageError(reason);
                                    onReady("");
                                }}
                            />
                        ) : null}
                        <Select
                            aria-label="试播动作"
                            className="w-full"
                            value={action || pet.bindings.idle}
                            onChange={(id) => {
                                setAction(id);
                            }}
                            options={pet.actions.map((a) => ({ value: a.id, label: a.label || a.id }))}
                        />
                        <small className="text-foreground/60">预览动作仅用于试播，保存后按真实任务状态播放。</small>
                    </div>
                    {invalid ? <Alert type="error" title="动作配置需要调整" description={invalid} showIcon /> : null}
                    {imageError ? (
                        <Alert
                            type="warning"
                            title="宠物预览未就绪"
                            description={imageError}
                            action={
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setImageError("");
                                        setAttempt((n) => n + 1);
                                    }}
                                >
                                    重试
                                </Button>
                            }
                            showIcon
                        />
                    ) : null}
                    <details>
                        <summary className="cursor-pointer text-sm font-medium">高级动作设置</summary>
                        <div className="mt-3 grid gap-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <label className="grid gap-1">
                                    单帧宽度
                                    <InputNumber aria-label="单帧宽度" min={8} max={4096} precision={0} value={pet.frameWidth} disabled={disabled} onChange={(n) => n !== null && change({ frameWidth: n })} />
                                </label>
                                <label className="grid gap-1">
                                    单帧高度
                                    <InputNumber aria-label="单帧高度" min={8} max={4096} precision={0} value={pet.frameHeight} disabled={disabled} onChange={(n) => n !== null && change({ frameHeight: n })} />
                                </label>
                                <label className="grid gap-1">
                                    播放倍率
                                    <InputNumber aria-label="播放倍率" min={0.25} max={3} step={0.25} value={pet.speed} disabled={disabled} onChange={(n) => n !== null && change({ speed: n })} />
                                </label>
                                <label className="grid gap-1">
                                    中立帧序号
                                    <InputNumber aria-label="中立帧序号" min={0} precision={0} value={pet.neutralFrame} disabled={disabled} onChange={(n) => n !== null && change({ neutralFrame: n })} />
                                </label>
                            </div>
                            <details className="min-w-0">
                                <summary className="cursor-pointer text-sm font-medium">编辑动作帧（{pet.actions.length} 个）</summary>
                                <p className="my-2 text-xs text-foreground/60">行、起始列、中立帧均从 0 开始。新增睡觉等动作需要图集中已有对应图片帧。</p>
                                <div className="grid gap-3">
                                    {pet.actions.map((a, index) => (
                                        <div key={index} className="grid gap-2 rounded-lg border border-border p-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <label className="grid gap-1 text-xs">
                                                    动作标识
                                                    <Input
                                                        aria-label={`动作${index + 1}标识`}
                                                        value={a.id}
                                                        disabled={disabled}
                                                        onChange={(e) => {
                                                            const id = e.target.value;
                                                            const bindings = { ...pet.bindings };
                                                            for (const key of Object.keys(bindings) as SpriteBinding[]) if (bindings[key] === a.id) bindings[key] = id;
                                                            change({ bindings, actions: pet.actions.map((item, i) => (i === index ? { ...item, id } : item)) });
                                                            if (action === a.id) setAction(id);
                                                        }}
                                                    />
                                                </label>
                                                <label className="grid gap-1 text-xs">
                                                    显示名称
                                                    <Input aria-label={`动作${index + 1}名称`} maxLength={40} value={a.label} disabled={disabled} onChange={(e) => updateAction(index, { label: e.target.value })} />
                                                </label>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                {(
                                                    [
                                                        ["row", "行"],
                                                        ["start", "起始列"],
                                                        ["frames", "帧数"],
                                                        ["fps", "帧率"],
                                                    ] as const
                                                ).map(([key, label]) => (
                                                    <label key={key} className="grid gap-1 text-xs">
                                                        {label}
                                                        <InputNumber
                                                            aria-label={`动作${index + 1}${label}`}
                                                            min={key === "row" || key === "start" ? 0 : 1}
                                                            max={key === "fps" ? 30 : 64}
                                                            precision={key === "fps" ? 1 : 0}
                                                            value={a[key]}
                                                            disabled={disabled}
                                                            onChange={(n) => n !== null && updateAction(index, { [key]: n })}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="flex items-center gap-2 text-xs">
                                                    <Switch size="small" aria-label={`动作${index + 1}循环`} checked={a.loop} disabled={disabled} onChange={(loop) => updateAction(index, { loop })} />
                                                    循环
                                                </label>
                                                <Button
                                                    size="small"
                                                    danger
                                                    icon={<Trash2 className="size-3" />}
                                                    disabled={disabled || pet.actions.length < 2}
                                                    onClick={() => {
                                                        const remaining = pet.actions.filter((_, i) => i !== index),
                                                            bindings = { ...pet.bindings };
                                                        for (const key of Object.keys(bindings) as SpriteBinding[]) if (bindings[key] === a.id) bindings[key] = key === "idle" ? remaining[0].id : "";
                                                        change({ actions: remaining, bindings });
                                                        if (action === a.id) setAction("");
                                                    }}
                                                >
                                                    删除动作
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <Button
                                    className="mt-3"
                                    icon={<Plus className="size-4" />}
                                    disabled={disabled || pet.actions.length >= 48}
                                    onClick={() => {
                                        let n = 1;
                                        while (pet.actions.some((a) => a.id === `action-${n}`)) n++;
                                        change({ actions: [...pet.actions, { id: `action-${n}`, label: "新动作", row: 0, start: 0, frames: 1, fps: 6, loop: false }] });
                                    }}
                                >
                                    添加动作
                                </Button>
                            </details>
                            <details>
                                <summary className="cursor-pointer text-sm font-medium">状态与互动映射</summary>
                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {(Object.entries(SPRITE_BINDING_LABELS) as [SpriteBinding, string][]).map(([key, label]) => (
                                        <label key={key} className="grid gap-1 text-xs">
                                            {label}
                                            <Select
                                                aria-label={`${label}动作映射`}
                                                value={pet.bindings[key] || ""}
                                                disabled={disabled}
                                                onChange={(id) => change({ bindings: { ...pet.bindings, [key]: id }, ...(key === "sleep" && !id ? { sleepAfterSeconds: 0 } : {}) })}
                                                options={[...(key !== "idle" ? [{ value: "", label: "不播放 / 使用待机" }] : []), ...pet.actions.map((a) => ({ value: a.id, label: a.label || a.id }))]}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </details>
                            <details>
                                <summary className="cursor-pointer text-sm font-medium">注视、睡眠与素材信息</summary>
                                <div className="mt-3 grid gap-3 text-sm">
                                    <label className="grid gap-1">
                                        鼠标注视
                                        <Select
                                            aria-label="鼠标注视方向"
                                            value={pet.lookDirections}
                                            disabled={disabled}
                                            onChange={(lookDirections) => change({ lookDirections })}
                                            options={[
                                                { value: 0, label: "关闭" },
                                                { value: 8, label: "8 个方向" },
                                                { value: 16, label: "16 个方向" },
                                            ]}
                                        />
                                    </label>
                                    {pet.lookDirections > 0 ? (
                                        <label className="grid gap-1">
                                            注视起始帧
                                            <InputNumber aria-label="注视起始帧" min={0} precision={0} value={pet.lookStartFrame} disabled={disabled} onChange={(n) => n !== null && change({ lookStartFrame: n })} />
                                        </label>
                                    ) : null}
                                    <label className="flex items-center gap-2">
                                        <Switch aria-label="自动睡眠" checked={pet.sleepAfterSeconds > 0} disabled={disabled || !pet.bindings.sleep} onChange={(enabled) => change({ sleepAfterSeconds: enabled ? 300 : 0 })} />
                                        空闲时自动睡眠
                                    </label>
                                    {pet.sleepAfterSeconds > 0 ? (
                                        <label className="grid gap-1">
                                            空闲秒数
                                            <InputNumber aria-label="睡眠空闲秒数" min={60} max={3600} precision={0} value={pet.sleepAfterSeconds} disabled={disabled} onChange={(n) => n !== null && change({ sleepAfterSeconds: n })} />
                                        </label>
                                    ) : (
                                        <small className="text-foreground/60">绑定睡眠动作后可开启；任务和审批会阻止自动入睡。</small>
                                    )}
                                    {(
                                        [
                                            ["author", "作者"],
                                            ["source", "素材来源"],
                                            ["license", "授权备注"],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <label key={key} className="grid gap-1">
                                            {label}
                                            <Input aria-label={`宠物${label}`} value={pet[key]} maxLength={key === "author" ? 120 : 500} disabled={disabled} onChange={(e) => change({ [key]: e.target.value })} />
                                        </label>
                                    ))}
                                </div>
                            </details>
                            <Button
                                icon={<Download className="size-4" />}
                                disabled={Boolean(invalid)}
                                onClick={() => {
                                    const blob = new Blob([JSON.stringify({ displayName: pet.displayName, spritesheetPath: pet.spritesheetPath.split("/").pop(), yinghui: { ...pet, spritesheetPath: pet.spritesheetPath.split("/").pop() } }, null, 2)], {
                                        type: "application/json",
                                    });
                                    const link = document.createElement("a");
                                    link.href = URL.createObjectURL(blob);
                                    link.download = "pet.json";
                                    link.click();
                                    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                                }}
                            >
                                导出动作配置 pet.json
                            </Button>
                            <p className="text-xs text-foreground/60">
                                图集 {pet.atlasWidth}×{pet.atlasHeight}。导出配置可与原图片一起打包复用。调整只影响展示，不改变任务权限；点击页面顶部“保存修改”后生效。
                            </p>
                        </div>
                    </details>
                </>
            ) : (
                <p className="text-xs text-foreground/60">ZIP 内包含 pet.json 和一张 PNG / 静态 WebP 图集。可随包附带文字授权文件。</p>
            )}
        </section>
    );
}
