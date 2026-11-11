import { mediaSettingIssues } from "@/lib/media-settings";
import { parseImageParameters } from "@/lib/image-parameters";
import type { AiConfig } from "@/stores/use-config-store";

export function MediaSettingsNotice({ config, capability, onChange }: { config: AiConfig; capability: "image" | "video"; onChange: (field: string, value: string) => void }) {
    const issues = mediaSettingIssues(config, capability);
    if (!issues.length) return null;
    return (
        <div role="alert" className="space-y-2 rounded-md border border-[var(--border)] p-2 text-xs">
            <p>以下设置格式无效，请修正后生成。</p>
            {issues.map((item) => (
                <div key={`${item.extension ? "extension:" : ""}${item.field}`} className="space-y-1">
                    <p>{item.message}</p>
                    {item.extension ? (
                        <button
                            type="button"
                            className="underline"
                            onClick={() => {
                                const next = { ...parseImageParameters(config.imageParameters) };
                                delete next[item.field];
                                onChange("imageParameters", JSON.stringify(next));
                            }}
                        >
                            移除 {item.label} 的原值
                        </button>
                    ) : item.suggested !== undefined ? (
                        <button type="button" className="underline" onClick={() => onChange(item.field, item.suggested!)}>
                            {item.suggested ? `改用模型默认值 ${item.suggested}` : "取消此设置"}
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
