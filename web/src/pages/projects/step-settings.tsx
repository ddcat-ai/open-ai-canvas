import { Button } from "antd";
import { TriangleAlert } from "lucide-react";

import { dramaChoiceKey, dramaVideoResolutionIssue } from "@/lib/drama/model-choice";
import { formatVideoResolutionLabel, videoResolutionComparisonKey } from "@/lib/video-generation-options";
import type { DramaAssetSettings, DramaCastKind, DramaModelChoice, DramaModelOption, DramaModelOverride, DramaModels, DramaSkillRef } from "@/services/api/drama";

import { DramaModelPicker, useDramaModelCatalog } from "./drama-model-picker";
import { PromptSkillField, type DramaSkillStep } from "./prompt-skill";

// 制作步骤的模型与技能：每个文字步骤一行（文本模型 + 写作技能），每类参考图一行（图片模型 + 分辨率）。
// 单独指定的模型为空时沿用“制作模型”里的默认模型，行内显示实际会用哪个。

const TEXT_STEPS: Array<{ step: DramaSkillStep; override: DramaModelOverride; label: string; hint: string }> = [
    { step: "bible", override: "bibleText", label: "资产提取", hint: "从原文提取角色、道具、场景与全剧画面规则" },
    { step: "script", override: "scriptText", label: "分镜拆分", hint: "每集改编为镜头表，输出最长、最慢的一步" },
    { step: "prompt", override: "promptText", label: "视频提示词", hint: "按镜头表把每个剧情段写成完整视频提示词" },
];

const IMAGE_KINDS: Array<{ kind: DramaCastKind; override: DramaModelOverride; resolution: "resolution" | "propResolution" | "sceneResolution"; label: string; hint: string }> = [
    { kind: "character", override: "characterImage", resolution: "resolution", label: "角色", hint: "画幅按参考图方案" },
    { kind: "prop", override: "propImage", resolution: "propResolution", label: "道具", hint: "16:9 单件展示" },
    { kind: "scene", override: "sceneImage", resolution: "sceneResolution", label: "场景", hint: "16:9 空间全景" },
];

export type DramaStepSkills = { bible?: DramaSkillRef; script?: DramaSkillRef; prompt?: DramaSkillRef };

const SKILL_FIELD: Record<DramaSkillStep, keyof DramaStepSkills> = { bible: "bible", script: "script", prompt: "prompt" };

function overrideOf(models: Partial<DramaModels> | undefined, key: DramaModelOverride) {
    const choice = models?.[key];
    return dramaChoiceKey(choice) ? choice : undefined;
}

function tierLabel(tier: string) {
    return tier.toUpperCase();
}

/** 一行里的模型选择：未单独指定时占位显示默认模型，指定后可一键恢复跟随默认。 */
function OverridePicker({ capability, value, fallback, onChange }: { capability: "text" | "image"; value?: DramaModelChoice; fallback?: DramaModelChoice; onChange: (choice?: DramaModelChoice) => void }) {
    return (
        <div className="drama-step-model">
            <DramaModelPicker capability={capability} size="sm" showPrice={false} value={value} placeholder={`跟随默认${fallback?.label ? ` · ${fallback.label}` : ""}`} onChange={onChange} />
            {value ? (
                <Button size="small" type="text" onClick={() => onChange(undefined)}>
                    跟随默认
                </Button>
            ) : null}
        </div>
    );
}

/** 文字步骤：资产提取、分镜拆分、视频提示词各自的文本模型与写作技能。 */
export function DramaTextSteps({
    models,
    onModelsChange,
    skills,
    onSkillChange,
}: {
    models?: Partial<DramaModels>;
    onModelsChange: (patch: Partial<DramaModels>) => void;
    skills: DramaStepSkills;
    onSkillChange: (step: DramaSkillStep, value?: DramaSkillRef) => void;
}) {
    return (
        <div className="drama-steps" role="list" aria-label="文字步骤">
            {TEXT_STEPS.map((item) => (
                <div key={item.step} className="drama-step-row" role="listitem">
                    <div className="drama-step-label">
                        <strong>{item.label}</strong>
                        <small>{item.hint}</small>
                    </div>
                    <div className="drama-step-field">
                        <span className="drama-step-caption">文本模型</span>
                        <OverridePicker capability="text" value={overrideOf(models, item.override)} fallback={models?.text} onChange={(choice) => onModelsChange({ [item.override]: choice || {} })} />
                    </div>
                    <div className="drama-step-field">
                        <span className="drama-step-caption">技能</span>
                        <PromptSkillField compact step={item.step} value={skills[SKILL_FIELD[item.step]]} onChange={(value) => onSkillChange(item.step, value)} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** 参考图：角色、道具、场景各自的图片模型与分辨率。分辨率档位取自该类实际使用的图片模型。 */
export function DramaAssetImageModels({
    models,
    onModelsChange,
    assets,
    onAssetsChange,
}: {
    models?: Partial<DramaModels>;
    onModelsChange: (patch: Partial<DramaModels>) => void;
    assets?: DramaAssetSettings;
    onAssetsChange: (assets: DramaAssetSettings) => void;
}) {
    const catalog = useDramaModelCatalog().data;
    const optionFor = (choice?: DramaModelChoice) => catalog?.options.image?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(choice));
    return (
        <div className="drama-steps" role="list" aria-label="参考图模型与分辨率">
            {IMAGE_KINDS.map((item) => {
                const override = overrideOf(models, item.override);
                const option = optionFor(override || models?.image);
                const tiers = option?.imageResolutions || [];
                const value = assets?.[item.resolution] || "";
                return (
                    <div key={item.kind} className="drama-step-row is-image" role="listitem">
                        <div className="drama-step-label">
                            <strong>{item.label}</strong>
                            <small>{item.hint}</small>
                        </div>
                        <div className="drama-step-field">
                            <span className="drama-step-caption">图片模型</span>
                            <OverridePicker capability="image" value={override} fallback={models?.image} onChange={(choice) => onModelsChange({ [item.override]: choice || {} })} />
                        </div>
                        <div className="drama-step-field">
                            <span className="drama-step-caption">分辨率</span>
                            {!option ? (
                                <small className="drama-step-note">选好图片模型后可选</small>
                            ) : tiers.length ? (
                                <div className="drama-tabs drama-res-tabs" role="radiogroup" aria-label={`${item.label}参考图分辨率`}>
                                    <button type="button" role="radio" className="drama-tab" aria-checked={!value} disabled={!assets} onClick={() => assets && onAssetsChange({ ...assets, [item.resolution]: undefined })}>
                                        默认{option.defaultImageResolution ? ` · ${tierLabel(option.defaultImageResolution)}` : ""}
                                    </button>
                                    {tiers.map((tier) => (
                                        <button key={tier} type="button" role="radio" className="drama-tab" aria-checked={value === tier} disabled={!assets} onClick={() => assets && onAssetsChange({ ...assets, [item.resolution]: tier })}>
                                            {tierLabel(tier)}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <small className="drama-step-note">该模型不提供分辨率档位，按默认尺寸出图</small>
                            )}
                            {value && option && !tiers.includes(value) ? (
                                <p className="drama-step-warn" role="alert">
                                    <TriangleAlert className="size-3.5" />
                                    该模型不支持 {tierLabel(value)}，保存时会被拒绝，请改选
                                </p>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** 剧情段视频分辨率：取自视频模型声明的档位；“模型默认”不发分辨率，由模型按默认档位出片。 */
export function VideoResolutionField({ option, value, onChange }: { option?: DramaModelOption; value?: string; onChange: (value?: string) => void }) {
    if (!option) {
        return value ? (
            <div className="drama-step-model">
                <small className="drama-step-note">已指定 {formatVideoResolutionLabel(value)}</small>
                <Button size="small" type="text" onClick={() => onChange(undefined)}>
                    改回默认
                </Button>
            </div>
        ) : (
            <small className="drama-step-note">选好视频模型后可选</small>
        );
    }
    const values = option.videoResolutions || [];
    const issue = dramaVideoResolutionIssue(option, value);
    if (!values.length && !value) return <small className="drama-step-note">该模型不提供可选分辨率，按默认出片</small>;
    return (
        <div className="drama-step-field">
            <div className="drama-tabs drama-res-tabs" role="radiogroup" aria-label="视频分辨率">
                <button type="button" role="radio" className="drama-tab" aria-checked={!value} onClick={() => onChange(undefined)}>
                    默认{option.defaultVideoResolution ? ` · ${formatVideoResolutionLabel(option.defaultVideoResolution)}` : ""}
                </button>
                {values.map((item) => (
                    <button key={item} type="button" role="radio" className="drama-tab" aria-checked={Boolean(value) && videoResolutionComparisonKey(value) === videoResolutionComparisonKey(item)} onClick={() => onChange(item)}>
                        {formatVideoResolutionLabel(item)}
                    </button>
                ))}
            </div>
            {issue ? (
                <p className="drama-step-warn" role="alert">
                    <TriangleAlert className="size-3.5" />
                    当前视频模型{issue}，保存时会被拒绝，请改选
                </p>
            ) : (
                <small className="drama-step-note">分辨率越高越清晰，单段越贵；横竖由作品画幅决定</small>
            )}
        </div>
    );
}
