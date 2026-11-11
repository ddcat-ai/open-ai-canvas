import { Button, Input, Select, Switch } from "antd";
import type { EcommerceDraft } from "@/services/api/ecommerce";

export function CopyFirstPanel({ draft, disabled, onChange, onPhotos }: { draft: EcommerceDraft; disabled: boolean; onChange: (patch: Partial<EcommerceDraft>) => void; onPhotos: () => void }) {
    return (
        <div className="ecs-field">
            <label>
                按文案创作 <Switch aria-label="按文案创作" checked={Boolean(draft.copyBrief)} disabled={disabled} onChange={(enabled) => onChange({ copyBrief: enabled ? { text: "", mode: "verbatim" } : undefined })} />
            </label>
            {draft.copyBrief ? (
                <>
                    <Input.TextArea
                        aria-label="给定文案"
                        value={draft.copyBrief.text}
                        disabled={disabled}
                        maxLength={8000}
                        autoSize={{ minRows: 5, maxRows: 12 }}
                        placeholder={"粘贴已确定的文案。按页提供时，用单独一行 --- 分隔，例如：\n温暖包裹\n毛绒鞋口\n---\n细节之美\n蝴蝶结与蕾丝"}
                        onChange={(event) => onChange({ copyBrief: { ...draft.copyBrief!, text: event.target.value } })}
                    />
                    <Select
                        aria-label="文案处理方式"
                        value={draft.copyBrief.mode}
                        disabled={disabled}
                        options={[
                            { value: "verbatim", label: "保留原文（只调整换行）" },
                            { value: "polish", label: "允许润色，出图前确认" },
                        ]}
                        onChange={(mode) => onChange({ copyBrief: { ...draft.copyBrief!, mode } })}
                    />
                    <p className="ecs-note">开始创作后，先确认逐张文案和画面，再生成配图。文字作为独立图层，可修改位置、字号和颜色。</p>
                    <Button disabled={disabled} onClick={onPhotos}>
                        用已上传实拍图直接排版
                    </Button>
                    <p className="ecs-note">实拍排版保留原文、照片及原比例，不调用模型、不消耗生成积分。按上传顺序配图；一张照片可共用。</p>
                </>
            ) : null}
        </div>
    );
}
