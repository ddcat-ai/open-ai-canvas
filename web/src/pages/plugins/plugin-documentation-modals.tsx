import { Modal, Upload } from "antd";
import { CloudUpload, FileText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { useLocaleStore } from "@/stores/use-locale-store";

import pluginDevelopmentGuideEnglishMarkdown from "./plugin-development-guide.en.md?raw";
import pluginDevelopmentGuideChineseMarkdown from "./plugin-development-guide.md?raw";
import { getPluginDocumentation } from "./plugin-documentation";
import { PluginMarkdown } from "./plugin-markdown";

type UploadPluginModalProps = {
    open: boolean;
    onClose: () => void;
    onUpload: (file: File) => void;
};

export function UploadPluginModal({ open, onClose, onUpload }: UploadPluginModalProps) {
    const { t, i18n } = useTranslation("plugins");
    const locale = useLocaleStore((state) => state.locale);
    const developmentGuide = (locale === "en" || i18n.language.startsWith("en")) ? pluginDevelopmentGuideEnglishMarkdown : pluginDevelopmentGuideChineseMarkdown;

    return (
        <Modal
            className="workspace-modal workspace-modal-wide plugin-upload-modal"
            title={t("plugins:upload-plugin")}
            open={open}
            centered
            footer={null}
            destroyOnHidden
            onCancel={onClose}
            styles={{ body: { maxHeight: "min(82vh, 900px)", overflowY: "auto", overscrollBehavior: "contain" } }}
        >
            <div className="plugin-upload-layout">
                <section className="plugin-upload-guide">
                    <PluginMarkdown source={developmentGuide} />
                </section>
                <aside className="plugin-upload-panel">
                    <div className="plugin-upload-panel-heading">
                        <span className="plugin-upload-panel-icon"><CloudUpload className="size-5" /></span>
                        <div>
                            <h2>{t("plugins:install-plugin-package")}</h2>
                            <p>{t("plugins:select-valid-plugin-manifest")}</p>
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
                        <p className="ant-upload-text">{t("plugins:select-plugin-file")}</p>
                        <p className="ant-upload-hint">{t("plugins:plugin-file-requirements")}</p>
                    </Upload.Dragger>
                    <div className="plugin-upload-notice">
                        <ShieldCheck className="size-4" />
                        <span>{t("plugins:plugin-upload-security-notice")}</span>
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
    const { t } = useTranslation("plugins");

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
            {plugin ? <PluginMarkdown className="plugin-details-document" source={getPluginDocumentation(plugin.manifest, t)} /> : null}
        </Modal>
    );
}
