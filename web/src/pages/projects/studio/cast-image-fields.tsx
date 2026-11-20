import { useRef, useState } from "react";
import { App, Button, Input, Switch } from "antd";
import { RefreshCw } from "lucide-react";

import { DEFAULT_DRAMA_STYLE_ID, findDramaStyle } from "@/lib/drama/drama-styles";
import { rebuildDramaCastImagePrompt, type DramaCastImageStyle } from "@/services/api/drama";
import { StyleCompositionPicker } from "../style-picker";

export type CastImageFieldsValue = DramaCastImageStyle & { imagePrompt?: string };

export function CastImageFields({
    projectId,
    castId,
    appearance,
    value,
    onChange,
    disabled = false,
}: {
    projectId: string;
    castId?: string;
    appearance: string;
    value: CastImageFieldsValue;
    onChange: (patch: CastImageFieldsValue) => void;
    disabled?: boolean;
}) {
    const { message } = App.useApp();
    const [building, setBuilding] = useState(false);
    const snapshot = JSON.stringify({ projectId, castId, appearance, ...value });
    const latest = useRef(snapshot);
    latest.current = snapshot;
    const ownStyle = Boolean(value.imageStyleId || value.imageStyleName || value.imageStylePrompt);
    const chooseStyle = (id: string) => {
        const style = findDramaStyle(id);
        if (style) onChange({ imageStyleId: style.id, imageStyleName: style.name, imageStylePrompt: style.prompt });
    };
    const rebuild = async () => {
        if (!castId) return;
        setBuilding(true);
        try {
            const result = await rebuildDramaCastImagePrompt(projectId, castId, { appearance, imageStyleId: value.imageStyleId || "", imageStyleName: value.imageStyleName || "", imageStylePrompt: value.imageStylePrompt || "" });
            if (latest.current === snapshot) {
                onChange({ imagePrompt: result.imagePrompt });
                message.success("提示词已重新编排，保存后用于生成参考图");
            } else message.info("设定已变化，请按最新内容重新编排提示词");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "编排提示词失败");
        } finally {
            setBuilding(false);
        }
    };
    return (
        <div className="drama-cast-image-fields">
            <label className="drama-switch-label">
                <Switch
                    size="small"
                    checked={ownStyle}
                    disabled={disabled || building}
                    onChange={(checked) => (checked ? chooseStyle(value.imageStyleId || DEFAULT_DRAMA_STYLE_ID) : onChange({ imageStyleId: "", imageStyleName: "", imageStylePrompt: "" }))}
                />
                为此设定单独设置风格
            </label>
            {ownStyle ? (
                <StyleCompositionPicker value={value.imageStyleId || DEFAULT_DRAMA_STYLE_ID} onChange={chooseStyle} disabled={disabled || building} />
            ) : (
                <small className="drama-editor-note">沿用作品风格；穿越、幼年或不同世界的造型可在此单独选择。</small>
            )}
            <div className="drama-field-label">
                <span>参考图生成提示词</span>
                {castId ? (
                    <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} loading={building} disabled={disabled || !appearance.trim()} onClick={() => void rebuild()}>
                        重新编排提示词
                    </Button>
                ) : null}
            </div>
            <Input.TextArea
                aria-label="参考图生成提示词"
                value={value.imagePrompt || ""}
                maxLength={12000}
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={disabled || building}
                placeholder="留空按外观、风格和参考图方案自动编排；也可填写自己的生图要求"
                onChange={(event) => onChange({ imagePrompt: event.target.value })}
            />
            <small className="drama-editor-note">切换风格后可重新编排提示词。编排不调用模型；保存设定后，点击生成才开始生图。</small>
        </div>
    );
}
