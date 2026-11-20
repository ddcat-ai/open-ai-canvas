import { Input, Select } from "antd";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { creationOptions } from "./type-config";

export function CreationOptions({ draft, onChange, className = "ecommerce-field" }: { draft: EcommerceDraft; onChange: (value: Record<string, string>) => void; className?: string }) {
    return (
        <div className="ecommerce-creation-options" aria-label="当前创作类型专属设置">
            {(creationOptions[draft.imageType] || []).map((item) => (
                <label className={className} key={item.key}>
                    <span>
                        {item.label}
                        {item.required ? " · 必填" : ""}
                    </span>
                    {item.choices ? (
                        <Select
                            aria-label={item.label}
                            allowClear
                            placeholder="由 Agent 根据资料策划"
                            value={draft.typeOptions?.[item.key] || undefined}
                            options={item.choices.map((value) => ({ value, label: value }))}
                            onChange={(value) => onChange({ ...draft.typeOptions, [item.key]: value || "" })}
                        />
                    ) : (
                        <Input.TextArea rows={2} value={draft.typeOptions?.[item.key] || ""} placeholder={item.placeholder} onChange={(event) => onChange({ ...draft.typeOptions, [item.key]: event.target.value })} />
                    )}
                </label>
            ))}
        </div>
    );
}
