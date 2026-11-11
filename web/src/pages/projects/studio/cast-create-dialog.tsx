import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Input, Select } from "antd";

import { AppModal } from "@/components/ui/product/app-modal";
import { createDramaCast, type DramaCast, type DramaCastKind } from "@/services/api/drama";
import { CAST_KIND_LABEL } from "../drama-shared";
import { CastImageFields, type CastImageFieldsValue } from "./cast-image-fields";

export function CastCreateDialog({ projectId, initialKind, onClose, onCreated }: { projectId: string; initialKind: DramaCastKind; onClose: () => void; onCreated: (cast: DramaCast) => void }) {
    const { message } = App.useApp();
    const [kind, setKind] = useState(initialKind);
    const [name, setName] = useState("");
    const [appearance, setAppearance] = useState("");
    const [imageFields, setImageFields] = useState<CastImageFieldsValue>({});
    const create = useMutation({
        mutationFn: () => createDramaCast(projectId, { kind, name: name.trim(), appearance: appearance.trim(), ...imageFields }),
        onSuccess: ({ cast }) => {
            message.success("设定已保存，可上传参考图或单独生成");
            onCreated(cast);
            onClose();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "新增设定失败"),
    });
    return (
        <AppModal
            open
            title="新增设定"
            rootClassName="drama-root"
            width={600}
            onCancel={() => !create.isPending && onClose()}
            onOk={() => create.mutate()}
            okText="保存设定"
            cancelText="取消"
            confirmLoading={create.isPending}
            okButtonProps={{ disabled: !name.trim() || !appearance.trim() }}
            cancelButtonProps={{ disabled: create.isPending }}
            maskClosable={!create.isPending}
            closable={!create.isPending}
        >
            <div className="drama-cast-form">
                <label className="drama-field">
                    <span className="drama-field-label">设定类型</span>
                    <Select aria-label="设定类型" value={kind} disabled={create.isPending} onChange={setKind} options={(["character", "scene", "prop"] as const).map((value) => ({ value, label: CAST_KIND_LABEL[value] }))} />
                </label>
                <label className="drama-field">
                    <span className="drama-field-label">名称</span>
                    <Input aria-label="新设定名称" value={name} maxLength={60} disabled={create.isPending} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="drama-field">
                    <span className="drama-field-label">外观与设定描述</span>
                    <Input.TextArea
                        aria-label="新设定外观"
                        value={appearance}
                        maxLength={1000}
                        autoSize={{ minRows: 3, maxRows: 7 }}
                        disabled={create.isPending}
                        onChange={(event) => setAppearance(event.target.value)}
                        placeholder="描述角色的外貌、场景环境或道具外形"
                    />
                </label>
                <CastImageFields projectId={projectId} appearance={appearance} value={imageFields} disabled={create.isPending} onChange={(patch) => setImageFields((current) => ({ ...current, ...patch }))} />
            </div>
        </AppModal>
    );
}
