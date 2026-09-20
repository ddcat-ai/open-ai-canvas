import { App, Modal, Upload } from "antd";
import { CloudUpload, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";

import pluginDevelopmentGuideMarkdown from "./plugin-development-guide.md?raw";
import { getPluginDocumentation } from "./plugin-documentation";
import { PluginMarkdown } from "./plugin-markdown";
import "./plugins.css";

type UploadPluginModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (file: File) => void | Promise<void>;
};

const MANIFEST_EXAMPLE = pluginDevelopmentGuideMarkdown.match(/```json\s*([\s\S]*?)```/)?.[1].trim();

export function UploadPluginModal({ open, onClose, onUpload }: UploadPluginModalProps) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<"install" | "guide">("install");
    const [isDraggingPlugin, setIsDraggingPlugin] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [copied, setCopied] = useState(false);
    const dragDepth = useRef(0);
    const uploadInFlight = useRef(false);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        if (!open) {
            setActiveTab("install");
            setIsDraggingPlugin(false);
            setCopied(false);
            dragDepth.current = 0;
        }
        return () => clearTimeout(copyTimer.current);
    }, [open]);

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

    const handleExecuteUpload = async (file: File) => {
        if (uploadInFlight.current) return;
        uploadInFlight.current = true;
        setUploading(true);
        try {
            await onUpload(file);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "安装插件失败");
        } finally {
            uploadInFlight.current = false;
            setUploading(false);
        }
    };

    const copySnippet = async () => {
        try {
            if (!MANIFEST_EXAMPLE) throw new Error("开发规范中缺少清单示例");
            if (!navigator.clipboard) throw new Error("当前环境不支持剪贴板，请从开发规范中手动复制");
            await navigator.clipboard.writeText(MANIFEST_EXAMPLE);
            setCopied(true);
            clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "复制失败，请手动复制");
        }
    };

    const isCompact = activeTab === "install";

    return (
        <Modal
            className={`workspace-modal plugin-upload-modal ${isCompact ? "plugin-upload-modal-compact" : "workspace-modal-wide"}`}
            title="上传插件"
            open={open}
            centered
            footer={null}
            destroyOnHidden
            closable={!uploading}
            mask={{ closable: !uploading }}
            onCancel={uploading ? undefined : onClose}
            styles={{ body: { maxHeight: "min(84vh, 900px)", overflowY: "auto", overscrollBehavior: "contain", padding: "16px 20px 24px" } }}
        >
            <div className="plugin-upload-tabs-bar">
                <div className="plugin-upload-tabs-nav">
                    <button type="button" className={`plugin-upload-tab-btn ${activeTab === "install" ? "is-active" : ""}`} aria-pressed={activeTab === "install"} onClick={() => setActiveTab("install")}>
                        <CloudUpload className="size-4" />
                        <span>安装插件包</span>
                    </button>
                    <button type="button" className={`plugin-upload-tab-btn ${activeTab === "guide" ? "is-active" : ""}`} aria-pressed={activeTab === "guide"} onClick={() => setActiveTab("guide")}>
                        <FileText className="size-4" />
                        <span>开发规范与示例</span>
                    </button>
                </div>
                {activeTab === "guide" ? (
                    <button type="button" className="plugin-upload-copy-btn" onClick={() => void copySnippet()} title="复制开发规范中的 manifest.json 配置示例">
                        <span>{copied ? "已复制清单" : "复制清单示例"}</span>
                    </button>
                ) : (
                    <div className="plugin-upload-badge">
                        <ShieldCheck className="size-3.5 text-status-success" />
                        <span>沙箱受控隔离</span>
                    </div>
                )}
            </div>

            {activeTab === "install" ? (
                <div className="plugin-upload-install-view">
                    <div className="plugin-upload-panel-heading">
                        <span className="plugin-upload-panel-icon">
                            <CloudUpload className="size-5" />
                        </span>
                        <div>
                            <h2>安装插件包</h2>
                            <p>选择统一站点插件包，安装后会立即进入插件中心。</p>
                        </div>
                    </div>

                    <div
                        className={`plugin-upload-dropzone-shell${isDraggingPlugin ? " is-dragging" : ""}${uploading ? " is-uploading" : ""}`}
                        onDragEnter={handlePluginDragEnter}
                        onDragLeave={handlePluginDragLeave}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handlePluginDrop}
                    >
                        <Upload.Dragger
                            className="plugin-upload-dropzone"
                            accept=".yingce-plugin,.zip"
                            maxCount={1}
                            disabled={uploading}
                            showUploadList={false}
                            beforeUpload={(file) => {
                                void handleExecuteUpload(file);
                                return false;
                            }}
                        >
                            {uploading ? (
                                <div className="py-6 flex flex-col items-center justify-center gap-3">
                                    <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                    <p className="ant-upload-text">正在安装插件包，请稍候...</p>
                                    <p className="ant-upload-hint">正在解压、校验清单合法性与版本声明</p>
                                </div>
                            ) : (
                                <>
                                    <CloudUpload className="plugin-upload-dropzone-icon" />
                                    <p className="ant-upload-text">{isDraggingPlugin ? "释放文件以上传插件" : "点击选择插件文件，也可拖拽到此处"}</p>
                                    <p className="ant-upload-hint">支持 .yingce-plugin 包 · 大小不超过 48 MiB</p>
                                </>
                            )}
                        </Upload.Dragger>
                    </div>

                    <div className="plugin-upload-notice">
                        <ShieldCheck className="size-4 shrink-0 text-status-success" />
                        <span>上传前请确认插件来源可信。Web 入口只能进入声明的隔离运行时，不会获得主页面权限；密钥也不会从清单读取。</span>
                    </div>

                    <div className="plugin-upload-switch-guide-hint">
                        <span>初次制作插件？</span>
                        <button type="button" onClick={() => setActiveTab("guide")} className="plugin-upload-link-btn">
                            查看《开发与打包规范说明》
                        </button>
                    </div>
                </div>
            ) : (
                <div className="plugin-upload-guide-view">
                    <div className="plugin-upload-guide-banner">
                        <ShieldCheck className="size-4 shrink-0 text-primary" />
                        <span>以下为开发者技术规范与清单编写参考（只读文档）。安装插件请切换至「安装插件包」。</span>
                    </div>
                    <section className="plugin-upload-guide">
                        <PluginMarkdown source={pluginDevelopmentGuideMarkdown} />
                    </section>
                </div>
            )}
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
            title={
                plugin ? (
                    <div className="plugin-details-title">
                        <FileText className="size-4" />
                        <span>{plugin.manifest.name}</span>
                        <span className="plugin-version">v{plugin.manifest.version}</span>
                    </div>
                ) : null
            }
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
