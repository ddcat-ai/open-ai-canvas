import { useEffect, useState } from "react";
import { App, Input, Select } from "antd";
import { useQueryClient } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { canvasTemplateDocumentFromSelection } from "@/lib/canvas/canvas-templates";
import { createCanvasTemplate } from "@/services/api/canvas-templates";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type Props = {
    open: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    onClose: () => void;
    onSaved?: () => void;
};

export function CanvasSaveTemplateModal({ open, nodes, connections, onClose, onSaved }: Props) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("image");
    const [tags, setTags] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle(nodes[0]?.title ? `${nodes[0].title} 工作流` : "我的画布模板");
        setDescription("从当前选中节点保存的画布工作流");
        setCategory("image");
        setTags("");
    }, [nodes, open]);

    const save = async () => {
        if (!title.trim()) {
            message.error("请填写模板名称");
            return;
        }
        setSaving(true);
        try {
            await createCanvasTemplate({
                title: title.trim(),
                description: description.trim(),
                category,
                tags: tags
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .slice(0, 12),
                document: canvasTemplateDocumentFromSelection(nodes, connections),
            });
            await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
            message.success("模板已保存到我的模板");
            onSaved?.();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal open={open} title="保存为模板" okText="保存模板" cancelText="取消" confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
            <div className="space-y-3 p-5">
                <Input value={title} maxLength={160} placeholder="模板名称" onChange={(event) => setTitle(event.target.value)} />
                <Input.TextArea value={description} maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="模板说明" onChange={(event) => setDescription(event.target.value)} />
                <Select
                    className="w-full"
                    value={category}
                    options={[
                        { value: "image", label: "图片" },
                        { value: "video", label: "视频" },
                        { value: "storyboard", label: "分镜" },
                        { value: "commerce", label: "电商" },
                    ]}
                    onChange={setCategory}
                />
                <Input value={tags} placeholder="标签，用逗号分隔" onChange={(event) => setTags(event.target.value)} />
                <div className="text-xs text-foreground/55">
                    将保存 {nodes.length} 个节点和 {connections.filter((connection) => nodes.some((node) => node.id === connection.fromNodeId) && nodes.some((node) => node.id === connection.toNodeId)).length} 条内部连线；媒体文件不会写入模板。
                </div>
            </div>
        </AppModal>
    );
}
