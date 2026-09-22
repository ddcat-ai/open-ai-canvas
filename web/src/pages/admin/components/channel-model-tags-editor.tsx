import { Button, Form, Input, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { ModelTags } from "@/components/model-tags";
import { modelTagColors, type ModelTag } from "@/lib/model-tags";

export function ChannelModelTagsEditor() {
    const form = Form.useFormInstance();
    const tags: ModelTag[] = Form.useWatch("tags", form) || [];
    return (
        <Form.Item label="展示标签" extra="最多 5 个，每个 12 字；展示在用户的二级渠道选项中，不改变实际计费。">
            <Form.List
                name="tags"
                rules={[
                    {
                        validator: async (_, value: ModelTag[] = []) => {
                            if (value.length > 5) throw new Error("最多添加 5 个标签");
                            const texts = value.map((tag) => tag?.text?.trim()).filter(Boolean);
                            if (new Set(texts).size !== texts.length) throw new Error("标签文字不能重复");
                        },
                    },
                ]}
            >
                {(fields, { add, remove }, { errors }) => (
                    <div className="grid gap-2">
                        {fields.map(({ key, name, ...rest }) => (
                            <div key={key} className="flex flex-wrap items-start gap-2">
                                <Form.Item
                                    {...rest}
                                    name={[name, "text"]}
                                    className="mb-0 min-w-32 flex-1"
                                    rules={[
                                        {
                                            validator: async (_, value: string) => {
                                                const length = Array.from(value?.trim() || "").length;
                                                if (length < 1 || length > 12) throw new Error("标签文字须为 1–12 字");
                                            },
                                        },
                                    ]}
                                >
                                    <Input aria-label={`标签 ${name + 1} 文字`} placeholder="例如：限时特价、官方1折" />
                                </Form.Item>
                                <Form.Item {...rest} name={[name, "color"]} className="mb-0 w-28" rules={[{ required: true, message: "请选择颜色" }]}>
                                    <Select
                                        aria-label={`标签 ${name + 1} 颜色`}
                                        options={modelTagColors.map((color) => ({
                                            value: color.value,
                                            label: (
                                                <span className="model-tag" data-color={color.value}>
                                                    {color.label}
                                                </span>
                                            ),
                                        }))}
                                    />
                                </Form.Item>
                                <Button type="text" aria-label={`删除标签 ${name + 1}`} icon={<Trash2 className="size-4" />} onClick={() => remove(name)} />
                            </div>
                        ))}
                        <Button type="dashed" icon={<Plus className="size-4" />} disabled={fields.length >= 5} onClick={() => add({ text: "", color: "purple" })}>
                            添加标签
                        </Button>
                        <Form.ErrorList errors={errors} />
                        {tags.some((tag) => tag?.text?.trim()) ? (
                            <div>
                                <span className="text-xs text-foreground/60">展示预览</span>
                                <ModelTags tags={tags.filter((tag) => tag?.text?.trim())} />
                            </div>
                        ) : null}
                    </div>
                )}
            </Form.List>
        </Form.Item>
    );
}
