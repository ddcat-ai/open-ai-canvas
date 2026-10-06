import { Modal } from "antd";

import { PREVIS_TEMPLATES, type PrevisTemplateId } from "@/lib/canvas/previs/previs-templates";

/**
 * 新建预演台镜头前的模板选择。
 *
 * 为什么必须显式选：过去新建场景无条件塞一个默认演员，
 * 产品镜头和空场景用户第一件事就是把它删掉。这里让开局内容由用户决定。
 * 没有「默认」按钮 —— 空场景本身就是那个选项，且它真的没有演员。
 */
export function CanvasPrevisTemplateModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (templateId: PrevisTemplateId) => void }) {
    return (
        <Modal open={open} onCancel={onClose} footer={null} width={560} title="选择镜头模板" destroyOnHidden>
            <div className="previs-template-grid">
                {PREVIS_TEMPLATES.map((template) => (
                    <button
                        key={template.id}
                        type="button"
                        className="previs-template-card"
                        onClick={() => {
                            onSelect(template.id);
                            onClose();
                        }}
                    >
                        <span className="previs-template-card-name">{template.name}</span>
                        <span className="previs-template-card-summary">{template.summary}</span>
                        <span className="previs-template-card-description">{template.description}</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}
