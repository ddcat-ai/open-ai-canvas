import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, Modal, Select } from "antd";
import { Archive, Check, Eye, Palette, Pencil, Save, ShieldAlert } from "lucide-react";

import { CanvasStyleDetailModal, CanvasStylePickerModal, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { updateProject } from "@/services/api/projects";
import { resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

import type { ProjectDetailViewProps } from "./shared";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export default function ProjectSettingsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { t } = useTranslation("project");
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const { project } = detail;
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description || "");
    const [aspectRatio, setAspectRatio] = useState(project.aspectRatio);
    const [sourceType, setSourceType] = useState(project.sourceType);
    const [stylePresetId, setStylePresetId] = useState(project.stylePresetId || "");
    const [styleProfileJson, setStyleProfileJson] = useState(project.styleProfileJson || "");
    const [styleDetail, setStyleDetail] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [styleEditorRequested, setStyleEditorRequested] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    useEffect(() => {
        setName(project.name);
        setDescription(project.description || "");
        setAspectRatio(project.aspectRatio);
        setSourceType(project.sourceType);
        setStylePresetId(project.stylePresetId || "");
        setStyleProfileJson(project.styleProfileJson || "");
    }, [project]);
    const dirty = useMemo(
        () =>
            name.trim() !== project.name ||
            description !== (project.description || "") ||
            aspectRatio !== project.aspectRatio ||
            sourceType !== project.sourceType ||
            stylePresetId !== (project.stylePresetId || "") ||
            styleProfileJson !== (project.styleProfileJson || ""),
        [aspectRatio, description, name, project, sourceType, stylePresetId, styleProfileJson],
    );
    const selectedStyle = useMemo(() => resolveProjectCanvasStyle(stylePresetId, styleProfileJson), [stylePresetId, styleProfileJson]);
    const styleProfile = useMemo(() => parseStyleProfile(styleProfileJson) || selectedStyle?.profile || (selectedStyle ? createStyleProfileSnapshot(selectedStyle) : null), [selectedStyle, styleProfileJson]);
    const enabledStyleAssets = styleProfile?.assets.filter((asset) => asset.enabled !== false) || [];
    const styleExecutionPlans = useMemo(() => {
        if (!styleProfile) return null;
        const imageConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.imageModel || effectiveConfig.model);
        const videoConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.videoModel || effectiveConfig.model);
        return {
            image: resolveStyleExecutionPlan(styleProfile, { mode: "image", model: imageConfig.model, interfaceType: imageConfig.interfaceType || imageConfig.apiFormat }),
            video: resolveStyleExecutionPlan(styleProfile, { mode: "video", model: videoConfig.model, interfaceType: videoConfig.interfaceType || videoConfig.apiFormat }),
        };
    }, [effectiveConfig, styleProfile]);
    const saveMutation = useMutation({
        mutationFn: () => updateProject(project.id, { name: name.trim(), description, aspectRatio, sourceType, stylePresetId, styleProfileJson }),
        onSuccess: () => {
            refreshProject();
            message.success(t("project:project-settings-saved"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-save-project-settings")),
    });
    const archiveMutation = useMutation({
        mutationFn: () => updateProject(project.id, { status: project.status === "archived" ? "active" : "archived" }),
        onSuccess: () => {
            setArchiveOpen(false);
            refreshProject();
            message.success(project.status === "archived" ? t("project:project-restored") : t("project:project-archived"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-update-project-status")),
    });

    return (
        <div>
            <header className="flex items-end justify-between gap-3 pb-3">
                <div>
                    <h2 className="text-lg font-semibold">{t("project:project-settings-2")}</h2>
                    <p className="mt-1 text-xs text-foreground/48">{t("project:basics-project-style-and-archive-management")}</p>
                </div>
                <Button type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!dirty || !name.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                    {dirty ? t("project:save-settings") : t("project:saved")}
                </Button>
            </header>

            <section className="py-5">
                <h3 className="mb-3 text-sm font-semibold">{t("project:basics")}</h3>
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label={t("project:project-name")} className="xl:col-span-2">
                        <Input value={name} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field label={t("project:default-aspect-ratio")}>
                        <Select
                            className="w-full"
                            value={aspectRatio}
                            options={[
                                { label: t("project:9-16-vertical-drama"), value: "9:16" },
                                { label: t("project:16-9-landscape"), value: "16:9" },
                                { label: t("project:1-1-square"), value: "1:1" },
                            ]}
                            onChange={setAspectRatio}
                        />
                    </Field>
                    <Field label={t("project:content-source")}>
                        <Select
                            className="w-full"
                            value={sourceType}
                            options={[
                                { label: t("project:start-blank-2"), value: "blank" },
                                { label: t("project:import-novel-4"), value: "novel" },
                                { label: t("project:paste-text-2"), value: "text" },
                            ]}
                            onChange={setSourceType}
                        />
                    </Field>
                    <Field label={t("project:synopsis")} className="md:col-span-2 xl:col-span-4">
                        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("project:describe-your-project-in-one-line")} />
                    </Field>
                </div>
            </section>

            <section className="py-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold">{t("project:project-style-2")}</h3>
                        <p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">{t("project:projects-snapshot-the-current-version-editing-my-styles-never-rewrites-p")}</p>
                    </div>
                    {styleProfile ? (
                        <span className="text-[var(--fs-label)] text-foreground/52">{styleProfile.source === "user" ? t("project:from-my-styles") : styleProfile.source === "external" ? t("project:imported") : t("project:system-preset")}</span>
                    ) : (
                        <span className="text-[var(--fs-label)] text-foreground/40">{t("project:not-set")}</span>
                    )}
                </div>
                <div className="flex flex-col gap-3 rounded-lg bg-surface-active p-3 lg:flex-row lg:items-center">
                    {selectedStyle ? (
                        <img src={selectedStyle.imageUrl} width="160" height="90" alt={t("project:style-preview-param", { title: selectedStyle.title })} className="aspect-video w-40 shrink-0 rounded-md object-cover" />
                    ) : (
                        <span className="grid aspect-video w-40 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/35">
                            <Palette className="size-5" />
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{styleProfile?.title || selectedStyle?.title || t("project:no-project-style-set-yet")}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/48">{styleProfile?.description || selectedStyle?.description || t("project:start-from-a-system-style-or-create-a-fully-editable-visual-spec")}</p>
                        {styleProfile ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {styleProfile.tags.map((tag) => (
                                    <span key={tag} className="rounded bg-foreground/10 px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/55">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <Button icon={<Eye className="size-3.5" />} disabled={!selectedStyle} onClick={() => setStyleDetail(selectedStyle || null)}>
                            {t("project:view-spec")}
                        </Button>
                        <Button
                            icon={<Pencil className="size-3.5" />}
                            disabled={!styleProfile}
                            onClick={() => {
                                setStyleEditorRequested(true);
                                setStylePickerOpen(true);
                            }}
                        >
                            {t("project:edit-style")}
                        </Button>
                        <Button
                            icon={<Palette className="size-3.5" />}
                            onClick={() => {
                                setStyleEditorRequested(false);
                                setStylePickerOpen(true);
                            }}
                        >
                            {selectedStyle ? t("project:change-style-2") : t("project:select-style")}
                        </Button>
                    </div>
                </div>
                {styleProfile ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                        <StyleMetric label={t("project:execution-policy")} value={styleProfile.executionPolicy === "strict-assets" ? t("project:strict-validation") : t("project:graceful-fallback")} />
                        <StyleMetric label={t("project:bound-assets")} value={t("project:param", { length: styleProfile.assets.length })} />
                        <StyleMetric label={t("project:enabled")} value={t("project:param", { length: enabledStyleAssets.length })} />
                        <StyleMetric label={t("project:image-execution")} value={styleExecutionStatusLabel(styleExecutionPlans?.image.status)} />
                        <StyleMetric label={t("project:video-execution")} value={styleExecutionStatusLabel(styleExecutionPlans?.video.status)} />
                    </div>
                ) : null}
                {styleExecutionPlans && (styleExecutionPlans.image.warnings.length || styleExecutionPlans.video.warnings.length) ? (
                    <div className="mt-2 grid gap-1 rounded-md bg-amber-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-amber-600 dark:text-amber-400">
                        {styleExecutionPlans.image.warnings.length ? (
                            <p>
                                {t("project:images-2")}
                                {styleExecutionPlans.image.warnings.join("；")}
                            </p>
                        ) : null}
                        {styleExecutionPlans.video.warnings.length ? (
                            <p>
                                {t("project:video")}
                                {styleExecutionPlans.video.warnings.join("；")}
                            </p>
                        ) : null}
                    </div>
                ) : null}
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500">
                            <Archive className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                            <h3 className="text-sm font-medium">{project.status === "archived" ? t("project:restore-project") : t("project:archive-project")}</h3>
                            <p className="mt-0.5 text-[var(--fs-label)] text-foreground/48">
                                {project.status === "archived" ? t("project:restoring-re-enables-chapters-canvases-and-generation-tasks") : t("project:keeps-all-chapters-canvases-and-assets-blocks-new-creation-and-generatio")}
                            </p>
                        </div>
                    </div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>
                        {project.status === "archived" ? t("project:restore-project") : t("project:archive-project")}
                    </Button>
                </div>
            </section>

            <Modal
                className="workspace-modal workspace-modal-compact"
                title={project.status === "archived" ? t("project:restore-project") : t("project:archive-project")}
                open={archiveOpen}
                okText={project.status === "archived" ? t("project:confirm-restore") : t("project:confirm-archive")}
                cancelText={t("project:cancel-4")}
                okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending }}
                onCancel={() => setArchiveOpen(false)}
                onOk={() => archiveMutation.mutate()}
                styles={{ body: { paddingTop: 12 } }}
            >
                <p className="m-0 text-sm leading-6 text-foreground/65">
                    {project.status === "archived" ? t("project:after-restoring-the-project-becomes-editable-again") : t("project:archiving-deletes-nothing-canvas-documents-remain-openable-under-canvas")}
                </p>
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={stylePresetId}
                currentProfile={styleProfile}
                startInEditor={styleEditorRequested}
                onClose={() => {
                    setStylePickerOpen(false);
                    setStyleEditorRequested(false);
                }}
                onSelect={(preset) => {
                    applyStyle(preset);
                    setStylePickerOpen(false);
                    setStyleEditorRequested(false);
                }}
            />
            <CanvasStyleDetailModal
                open={Boolean(styleDetail)}
                preset={styleDetail}
                selected={styleDetail?.id === stylePresetId}
                onClose={() => setStyleDetail(null)}
                onSelect={(preset) => {
                    applyStyle(preset);
                    setStyleDetail(null);
                }}
            />
        </div>
    );

    function applyStyle(preset: CanvasStylePreset) {
        setStylePresetId(preset.id);
        setStyleProfileJson(serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset)));
    }
}

function StyleMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-md bg-surface-active px-3 py-2">
            <span className="block text-[var(--fs-tiny)] text-foreground/40">{label}</span>
            <span className="mt-0.5 block truncate font-medium text-foreground/65">{value}</span>
        </div>
    );
}

function styleExecutionStatusLabel(status?: "ready" | "degraded" | "blocked") {
    return status === "blocked" ? t("project:blocked") : status === "degraded" ? t("project:fallback") : t("project:full-execution");
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <label className={`grid gap-1.5 text-xs ${className}`}>
            <span className="font-medium text-foreground/62">{label}</span>
            {children}
        </label>
    );
}
