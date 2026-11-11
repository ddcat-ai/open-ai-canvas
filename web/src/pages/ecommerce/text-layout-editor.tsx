import { useState } from "react";
import { Button, Input, Select, Slider } from "antd";
import type { EcommercePlanImage, EcommerceTextLayout } from "@/services/api/ecommerce";
import { CommerceResultImage } from "./result-image";
import { commerceCanvasAspect } from "./canvas-layout";
import { layoutCommerceText, measureCommerceText } from "./text-layout";

export function TextLayoutEditor({ image, src, onSave }: { image: EcommercePlanImage; src: string; onSave: (image: EcommercePlanImage) => Promise<void> }) {
    const [copy, setCopy] = useState(image.copy);
    const [layout, setLayout] = useState(image.textLayout!);
    const [ratio, setRatio] = useState(commerceCanvasAspect(image.ratio));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const update = (patch: Partial<EcommerceTextLayout>) => setLayout((current) => ({ ...current, ...patch }));
    return (
        <div className="commerce-output-preview">
            <CommerceResultImage ratio={ratio} src={src} copy={copy} textLayout={layout} alt="文字排版预览" onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
            <section>
                <label className="ecs-field">
                    字体
                    <Select
                        aria-label="文字字体"
                        disabled={busy}
                        value={layout.fontFamily || "sans"}
                        options={[
                            { value: "sans", label: "黑体" },
                            { value: "serif", label: "宋体" },
                            { value: "rounded", label: "圆体" },
                        ]}
                        onChange={(fontFamily) => update({ fontFamily })}
                    />
                </label>
                <p>只调整文字，不重新生成图片。保存后刷新仍可继续编辑，下载会合成完整图文。</p>
                <label className="ecs-field">
                    文案
                    <Input.TextArea aria-label="编辑成品文案" value={copy} maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} disabled={busy} onChange={(event) => setCopy(event.target.value)} />
                </label>
                {(
                    [
                        { key: "x", label: "左右位置", min: 0, max: 100 - layout.width },
                        { key: "y", label: "上下位置", min: 0, max: 90 },
                        { key: "width", label: "文字栏宽度", min: 10, max: 100 - layout.x },
                        { key: "fontSize", label: "字号", min: 1, max: 12 },
                    ] as const
                ).map((field) => (
                    <label className="ecs-field" key={field.key}>
                        {field.label}
                        <Slider aria-label={field.label} min={field.min} max={field.max} step={0.1} value={layout[field.key]} disabled={busy} onChange={(value) => update({ [field.key]: value })} />
                    </label>
                ))}
                <label className="ecs-field">
                    文字颜色
                    <input type="color" aria-label="文字颜色" value={layout.color} disabled={busy} onChange={(event) => update({ color: event.target.value })} />
                </label>
                <label className="ecs-field">
                    文字底色
                    <Select
                        aria-label="文字底色"
                        disabled={busy}
                        value={layout.background}
                        options={[
                            { value: "transparent", label: "透明" },
                            { value: "#ffffff", label: "白色" },
                            { value: "#222222", label: "深色" },
                        ]}
                        onChange={(background) => update({ background })}
                    />
                </label>
                <label className="ecs-field">
                    对齐
                    <Select
                        aria-label="文字对齐"
                        disabled={busy}
                        value={layout.align}
                        options={[
                            { value: "left", label: "左对齐" },
                            { value: "center", label: "居中" },
                            { value: "right", label: "右对齐" },
                        ]}
                        onChange={(align) => update({ align })}
                    />
                </label>
                {error ? <p role="alert">{error}</p> : null}
                <Button
                    type="primary"
                    loading={busy}
                    onClick={async () => {
                        if (busy) return;
                        setBusy(true);
                        setError("");
                        try {
                            const context = document.createElement("canvas").getContext("2d");
                            if (!context) throw new Error("浏览器无法创建文字排版画布");
                            layoutCommerceText(copy, layout, 1000, 1000 / ratio, measureCommerceText(context, layout.fontFamily));
                            await onSave({ ...image, copy, textLayout: layout });
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : "保存失败");
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    保存排版
                </Button>
            </section>
        </div>
    );
}
