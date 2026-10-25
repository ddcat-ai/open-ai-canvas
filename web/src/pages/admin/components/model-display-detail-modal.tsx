import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";

export function ModelDisplayDetailModal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
    return <AppModal
        open
        width={760}
        centered
        className="model-display-detail-modal"
        title={<div className="model-display-detail-title"><GripVertical size={16} /><span>{title}</span></div>}
        onCancel={onClose}
        maskClosable={false}
        footer={footer}
    >{children}</AppModal>;
}
