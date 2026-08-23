import { Modal, Upload } from "antd";
import { CloudUpload, FileText, ShieldCheck } from "lucide-react";

import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";

import pluginDevelopmentGuideMarkdown from "./plugin-development-guide.md?raw";
import { getPluginDocumentation } from "./plugin-documentation";
import { PluginMarkdown } from "./plugin-markdown";

type UploadPluginModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (file: File) => void;
};

export function UploadPluginModal({ open, onClose, onUpload }: UploadPluginModalProps) {
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
                            <p>选择符合清单规范的 JSON 文件，安装后会立即进入插件中心。</p>
                        </div>
                    </div>
                    <Upload.Dragger
                        className="plugin-upload-dropzone"
                        accept=".json,application/json"
                        maxCount={1}
                        showUploadList={false}
                        beforeUpload={(file) => {
                            onUpload(file);
                            return false;
                        }}
                    >
                        <CloudUpload className="plugin-upload-dropzone-icon" />
                        <p className="ant-upload-text">点击选择插件文件</p>
                        <p className="ant-upload-hint">仅支持 JSON 清单，大小不超过 512 KiB</p>
                    </Upload.Dragger>
                    <div className="plugin-upload-notice">
                        <ShieldCheck className="size-4" />
                        <span>上传前请确认插件来源可信。协议插件不会在浏览器执行任意脚本，密钥也不会从清单读取。</span>
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
