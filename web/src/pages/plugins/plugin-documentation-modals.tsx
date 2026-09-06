import { Modal, Upload } from "antd";
import { CloudUpload, FileText, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";

import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";

import pluginDevelopmentGuideMarkdown from "./plugin-development-guide.md?raw";
import { getPluginDocumentation } from "./plugin-documentation";
import { PluginMarkdown } from "./plugin-markdown";
import "./plugins.css";

type UploadPluginModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (file: File) => void;
};

export function UploadPluginModal({ open, onClose, onUpload }: UploadPluginModalProps) {
    const [isDraggingPlugin, setIsDraggingPlugin] = useState(false);
    const dragDepth = useRef(0);

    const handlePluginDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepth.current += 1;
        setIsDraggingPlugin(true);
    };

    const handlePluginDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setIsDraggingPlugin(false);
        }
    };

    const handlePluginDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepth.current = 0;
        setIsDraggingPlugin(false);
    };

    return (
        <Modal
            className="workspace-modal workspace-modal-wide plugin-upload-modal"
            title="上传插件"
            open={open}
            centered
            footer={null}
            destroyOnHidden
            onCancel={onClose}
            styles={{ body: { maxHeight: "min(82vh, 900px)", overflowY: "auto", overscrollBehavior: "contain" } }}
        >
            <div className="plugin-upload-layout">
                <section className="plugin-upload-guide">
                    <PluginMarkdown source={pluginDevelopmentGuideMarkdown} />
                </section>
                <aside className="plugin-upload-panel">
                    <div className="plugin-upload-panel-heading">
                        <span className="plugin-upload-panel-icon"><CloudUpload className="size-5" /></span>
                        <div>
                            <h2>安装插件包</h2>
                            <p>选择统一站点插件包，安装后会立即进入插件中心。</p>
                        </div>
                    </div>
                    <div
                        className={`plugin-upload-dropzone-shell${isDraggingPlugin ? " is-dragging" : ""}`}
                        onDragEnter={handlePluginDragEnter}
                        onDragLeave={handlePluginDragLeave}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handlePluginDrop}
                    >
                        <Upload.Dragger
                            className="plugin-upload-dropzone"
                            accept=".yingce-plugin,application/zip"
                            maxCount={1}
                            showUploadList={false}
                            beforeUpload={(file) => {
                                onUpload(file);
                                return false;
                            }}
                        >
                            <CloudUpload className="plugin-upload-dropzone-icon" />
                            <p className="ant-upload-text">{isDraggingPlugin ? "释放文件以上传插件" : "点击选择插件文件，也可拖拽到此处"}</p>
                            <p className="ant-upload-hint">支持 .yingce-plugin 包 · 大小不超过 16 MiB</p>
                        </Upload.Dragger>
                    </div>
                    <div className="plugin-upload-notice">
                        <ShieldCheck className="size-4" />
                        <span>上传前请确认插件来源可信。Web 入口只能进入声明的隔离运行时，不会获得主页面权限；密钥也不会从清单读取。</span>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

type PluginDetailsModalProps = {
    plugin?: RegisteredPlugin;
    restoreFocus: boolean;
    onClose: () => void;
};

export function PluginDetailsModal({ plugin, restoreFocus, onClose }: PluginDetailsModalProps) {
    return (
        <Modal
            className="workspace-modal workspace-modal-wide plugin-details-modal"
            title={plugin ? (
                <div className="plugin-details-title">
                    <FileText className="size-4" />
                    <span>{plugin.manifest.name}</span>
                    <span className="plugin-version">v{plugin.manifest.version}</span>
                </div>
            ) : null}
            open={Boolean(plugin)}
            centered
            footer={null}
            destroyOnHidden
            focusTriggerAfterClose={restoreFocus}
            onCancel={onClose}
            styles={{ body: { maxHeight: "min(78vh, 820px)", overflowY: "auto", overscrollBehavior: "contain" } }}
        >
            {plugin ? <PluginMarkdown className="plugin-details-document" source={getPluginDocumentation(plugin.manifest)} /> : null}
        </Modal>
    );
}
