import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Select } from "antd";
import { ArrowRight, BookOpenText, FileText, FolderKanban, Images, LayoutGrid, Palette, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, ListToolbar, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { settingsPath } from "@/lib/settings-navigation";
import { requestImageQuestion } from "@/services/api/image";
import { createProject, deleteProject, importProjectUnits, listProjects, type ProjectSummary } from "@/services/api/projects";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

import { sourceTypeLabel } from "./detail/shared";

import { useTranslation } from "react-i18next";

import { t } from "@/i18n";
import { buildShortDramaPrompt } from "./create-ai-prompt";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const { t } = useTranslation("project");
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const [createForm] = Form.useForm<ProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [storyDraft, setStoryDraft] = useState("");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [generateModel, setGenerateModel] = useState("");
    const [generateChapterCount, setGenerateChapterCount] = useState("5");
    const [generateStructure, setGenerateStructure] = useState(t("project:linear-progression"));
    const [generateChapterLength, setGenerateChapterLength] = useState(t("project:medium"));
    const [generateWordCount, setGenerateWordCount] = useState("800");
    const [generatePerspective, setGeneratePerspective] = useState(t("project:third-person"));
    const [generateTone, setGenerateTone] = useState(t("project:steady-narrative"));
    const [generateCharacterScale, setGenerateCharacterScale] = useState(t("project:3-4"));
    const [generating, setGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");
    const [generationPreview, setGenerationPreview] = useState("");
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const openCreate = (source: "blank" | "novel" | "text") => {
        setCreateSource(source);
        setCreateOpen(true);
    };
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({
            name: storyDraft.trim().slice(0, 24) || "",
            sourceType: createSource,
            aspectRatio: "9:16",
        });
    }, [createForm, createOpen, createSource, storyDraft]);

    const generateStory = async () => {
        const story = storyDraft.trim();
        if (!story || generating) return;
        const textModel = generateModel || effectiveConfig.textModel;
        if (!textModel || !effectiveConfig.textModels.includes(textModel)) {
            if (!textModel) {
                modal.warning({
                    title: t("project:select-a-text-model-first"),
                    content: t("project:pick-a-configured-text-model-under-ai-model-above-or-finish-channel-setu"),
                    okText: t("project:go-to-settings"),
                    cancelText: t("project:cancel-4"),
                    onOk: () => navigate(settingsPath("models")),
                });
            } else {
                message.error(t("project:model-param-is-not-in-the-text-model-list-please-choose-again", { textModel: textModel }));
            }
            return;
        }
        setGenerating(true);
        setGenerationStatus("creating");
        setGenerationPreview("");
        try {
            const project = await createUniqueProjectName(story, selectedStyle);
            setGenerationStatus("outline");
            const answer = await requestImageQuestion(
                { ...effectiveConfig, model: textModel, imageModel: textModel, videoModel: textModel, textModel },
                [
                    {
                        role: "system",
                        content: buildShortDramaPrompt({
                            chapterCount: generateChapterCount,
                            structure: generateStructure,
                            wordCount: generateWordCount,
                            perspective: generatePerspective,
                            tone: generateTone,
                            characterScale: generateCharacterScale,
                            chapterLength: generateChapterLength,
                        }),
                    },
                    { role: "user", content: story },
                ],
                (text) => {
                    setGenerationPreview(text);
                },
            );
            const parsed = parseGeneratedStory(answer);
            if (!parsed.chapters.length) throw new Error(t("project:ai-returned-no-valid-chapter-content-please-retry"));
            setGenerationStatus("importing");
            await importProjectUnits(
                project.project.id,
                parsed.chapters.map((chapter: { title: string; content: string }) => ({ kind: "chapter", title: chapter.title, sourceText: chapter.content })),
            );
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.project.id}/overview`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("project:ai-generation-failed-please-retry"));
        } finally {
            setGenerating(false);
            setGenerationStatus("");
            setGenerationPreview("");
        }
    };
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const query = useInfiniteQuery({
        // 分页查询和画布页的全量项目查询不能共用缓存形状，否则两个页面会互相覆盖缓存数据。
        queryKey: ["projects", "paged"],
        queryFn: ({ pageParam }) => listProjects({ page: pageParam, pageSize: 50 }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}/overview`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-create-project")),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteProject,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success(t("project:project-deleted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("project:failed-to-delete-project")),
    });
    const confirmDeleteProject = (projectId: string, name: string) => {
        modal.confirm({
            title: t("project:delete-project"),
            content: t("project:delete-param-project-chapters-canvas-links-and-asset-ownership-will-be-r", { name: name }),
            okText: t("project:delete"),
            okButtonProps: { danger: true, loading: deleteMutation.isPending },
            cancelText: t("project:cancel-4"),
            onOk: () => deleteMutation.mutate(projectId),
        });
    };
    const allProjects = useMemo(() => query.data?.pages.flatMap((page) => page.projects) || [], [query.data]);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...allProjects]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(
                ({ project }) =>
                    !normalizedKeyword ||
                    `${project.name} ${project.description} ${project.stylePresetId} ${parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword),
            )
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "zh-CN");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [allProjects, keyword, sort, status]);
    const totalProjectCount = query.data?.pages[0]?.total ?? allProjects.length;
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !query.hasNextPage || query.isError) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage]);
    const hasInitialError = query.isError && !query.data;
    return (
        <WorkspacePage className="library-page" grid>
            <section className="app-story-create-panel mt-4" aria-label={t("project:start-a-new-short-drama-2")}>
                <div className="app-story-create-head">
                    <div className="app-story-create-title">
                        <span className="app-story-create-mark">
                            <Sparkles className="size-4" />
                        </span>
                        <div>
                            <h2>{t("project:start-a-new-short-drama-2")}</h2>
                            <p>{t("project:write-a-one-line-story-or-pick-a-creation-mode")}</p>
                        </div>
                    </div>
                    <div className="app-story-create-actions">
                        <button type="button" className="app-story-create-shortcut" onClick={() => openCreate("blank")}>
                            <FolderKanban className="size-4" />
                            {t("project:blank-project")}
                        </button>
                        <button type="button" className="app-story-create-shortcut" onClick={() => openCreate("novel")}>
                            <FileText className="size-4" />
                            {t("project:import-novel-4")}
                        </button>
                        <button type="button" className="app-story-create-shortcut" onClick={() => setStylePickerOpen(true)}>
                            <Palette className="size-4" />
                            {selectedStyle ? t("project:change-style-2") : t("project:pick-style")}
                        </button>
                        <ModelPicker config={effectiveConfig} value={generateModel || effectiveConfig.textModel} onChange={setGenerateModel} capability="text" variant="creation" placeholder={t("project:select-text-model")} showSelectedPrice={false} />
                        <Button type="default" icon={<Sparkles className="size-3.5" />} disabled={!storyDraft.trim() || generating} loading={generating} onClick={() => void generateStory()}>
                            {t("project:generate-chapters-with-ai-2")}
                        </Button>
                        <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(createSource)}>
                            {t("project:start-creating")}
                        </Button>
                    </div>
                </div>
                <div className="app-story-create-main">
                    <Input.TextArea
                        className="app-story-create-input"
                        value={storyDraft}
                        onChange={(event) => setStoryDraft(event.target.value)}
                        placeholder={t("project:e-g-an-amnesiac-courier-receives-letters-mailed-ten-years-ago")}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        aria-label={t("project:one-line-story")}
                    />
                    {selectedStyle ? (
                        <button type="button" className="app-story-create-style-chip" onClick={() => setStylePickerOpen(true)} title={selectedStyle.title}>
                            <img src={selectedStyle.imageUrl} alt="" />
                            <span>{selectedStyle.title}</span>
                        </button>
                    ) : null}
                </div>
                <div className="app-story-create-controls">
                    <label>
                        <span>{t("project:chapter-count")}</span>
                        <Select
                            size="small"
                            className="min-w-28"
                            value={generateChapterCount}
                            onChange={setGenerateChapterCount}
                            options={[
                                { label: t("project:3-chapters"), value: "3" },
                                { label: t("project:5-chapters"), value: "5" },
                                { label: t("project:8-chapters"), value: "8" },
                                { label: t("project:10-chapters"), value: "10" },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:narrative-structure")}</span>
                        <Select
                            size="small"
                            className="min-w-32"
                            value={generateStructure}
                            onChange={setGenerateStructure}
                            options={[
                                { label: t("project:linear-progression"), value: t("project:linear-progression") },
                                { label: t("project:dual-timeline"), value: t("project:dual-timeline") },
                                { label: t("project:ensemble-threads"), value: t("project:ensemble-threads") },
                                { label: t("project:nested-twists"), value: t("project:nested-twists") },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:chapter-length")}</span>
                        <Select
                            size="small"
                            className="min-w-28"
                            value={generateChapterLength}
                            onChange={setGenerateChapterLength}
                            options={[
                                { label: t("project:concise"), value: t("project:short") },
                                { label: t("project:balanced"), value: t("project:medium") },
                                { label: t("project:full"), value: t("project:long") },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:words-per-chapter")}</span>
                        <Select
                            size="small"
                            className="min-w-28"
                            value={generateWordCount}
                            onChange={setGenerateWordCount}
                            options={[
                                { label: t("project:500-words"), value: "500" },
                                { label: t("project:800-words"), value: "800" },
                                { label: t("project:1-200-words"), value: "1200" },
                                { label: t("project:2-000-words"), value: "2000" },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:perspective")}</span>
                        <Select
                            size="small"
                            className="min-w-28"
                            value={generatePerspective}
                            onChange={setGeneratePerspective}
                            options={[
                                { label: t("project:third-person"), value: t("project:third-person") },
                                { label: t("project:first-person"), value: t("project:first-person") },
                                { label: t("project:multi-perspective"), value: t("project:multi-perspective") },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:tone")}</span>
                        <Select
                            size="small"
                            className="min-w-32"
                            value={generateTone}
                            onChange={setGenerateTone}
                            options={[
                                { label: t("project:steady-narrative"), value: t("project:steady-narrative") },
                                { label: t("project:light-comedy"), value: t("project:light-comedy") },
                                { label: t("project:tense-suspense"), value: t("project:tense-suspense") },
                                { label: t("project:hot-blooded-growth"), value: t("project:hot-blooded-growth") },
                                { label: t("project:sweet-and-healing"), value: t("project:sweet-and-healing") },
                            ]}
                        />
                    </label>
                    <label>
                        <span>{t("project:cast-size")}</span>
                        <Select
                            size="small"
                            className="min-w-28"
                            value={generateCharacterScale}
                            onChange={setGenerateCharacterScale}
                            options={[
                                { label: t("project:2"), value: t("project:2") },
                                { label: t("project:3-4"), value: t("project:3-4") },
                                { label: t("project:5-6"), value: t("project:5-6") },
                            ]}
                        />
                    </label>
                </div>
            </section>
            <ListToolbar
                className="library-toolbar"
                active={Boolean(keyword || status !== "all" || sort !== "updated")}
                onReset={() => {
                    setKeyword("");
                    setStatus("all");
                    setSort("updated");
                }}
            >
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder={t("project:search-projects-synopses-or-styles")} onChange={(event) => setKeyword(event.target.value)} />
                <Select
                    className="w-32"
                    value={status}
                    onChange={setStatus}
                    options={[
                        { label: t("project:all-statuses"), value: "all" },
                        { label: t("project:in-progress"), value: "active" },
                        { label: t("project:archived-2"), value: "archived" },
                    ]}
                />
                <Select
                    className="w-32"
                    value={sort}
                    onChange={setSort}
                    options={[
                        { label: t("project:recently-updated"), value: "updated" },
                        { label: t("project:chapter-progress-3"), value: "progress" },
                        { label: t("project:project-name"), value: "name" },
                    ]}
                />
            </ListToolbar>

            {hasInitialError ? <WorkspaceErrorState description={query.error instanceof Error ? query.error.message : t("project:failed-to-load-projects")} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label={t("project:organizing-projects")} detail={t("project:loading-chapter-canvas-and-asset-progress")} /> : null}
            {!query.isLoading && !hasInitialError && rows.length ? (
                <CollectionGrid className="library-grid project-library-grid">
                    {rows.map((row) => (
                        <ProjectRow key={row.project.id} row={row} onDelete={() => confirmDeleteProject(row.project.id, row.project.name)} />
                    ))}
                </CollectionGrid>
            ) : null}
            {!query.isLoading && !hasInitialError ? (
                <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                    {query.isFetchingNextPage ? (
                        t("project:loading-more-projects")
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.fetchNextPage()}>
                            {t("project:load-more-failed-click-to-retry")}
                        </button>
                    ) : query.hasNextPage ? (
                        t("project:scroll-for-more-50-per-page")
                    ) : allProjects.length ? (
                        t("project:all-param-projects-loaded", { totalProjectCount: totalProjectCount })
                    ) : null}
                </div>
            ) : null}
            {!query.isLoading && !rows.length && !hasInitialError && (keyword || status !== "all") ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? t("project:no-matching-projects") : t("project:create-your-first-story-project")}
                    description={keyword || status !== "all" ? t("project:adjust-the-search-term-or-status-filter-and-try-again") : t("project:projects-keep-chapters-canvases-characters-scenes-and-production-progres")}
                    action={
                        !keyword && status === "all" ? (
                            <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                                {t("project:create-project-2")}
                            </Button>
                        ) : undefined
                    }
                />
            ) : null}

            <Modal className="library-modal" title={t("project:create-short-drama-project")} open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm>
                    form={createForm}
                    layout="vertical"
                    initialValues={{ aspectRatio: "9:16", sourceType: "blank" }}
                    onFinish={(values) =>
                        mutation.mutate({ ...values, type: "short-drama", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })
                    }
                >
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"}
                            onClick={() => {
                                setCreateSource("blank");
                                createForm.setFieldValue("sourceType", "blank");
                            }}
                        >
                            <FolderKanban className="size-4" />
                            <span>{t("project:start-blank-2")}</span>
                        </button>
                        <button
                            type="button"
                            className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"}
                            onClick={() => {
                                setCreateSource("novel");
                                createForm.setFieldValue("sourceType", "novel");
                            }}
                        >
                            <FileText className="size-4" />
                            <span>{t("project:import-novel-4")}</span>
                        </button>
                        <button
                            type="button"
                            className={createSource === "text" ? "app-story-source is-active" : "app-story-source"}
                            onClick={() => {
                                setCreateSource("text");
                                createForm.setFieldValue("sourceType", "text");
                            }}
                        >
                            <BookOpenText className="size-4" />
                            <span>{t("project:paste-text-2")}</span>
                        </button>
                    </div>
                    <Form.Item name="name" label={t("project:project-name")} rules={[{ required: true, whitespace: true, message: t("project:enter-project-name") }]}>
                        <Input autoFocus placeholder={t("project:e-g-night-walk-in-chang-an")} />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label={t("project:default-aspect-ratio")}>
                            <Select
                                options={[
                                    { label: t("project:9-16-vertical"), value: "9:16" },
                                    { label: t("project:16-9-landscape-2"), value: "16:9" },
                                    { label: t("project:1-1-square-2"), value: "1:1" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item name="sourceType" label={t("project:content-source")}>
                            <Select
                                options={[
                                    { label: t("project:start-blank-2"), value: "blank" },
                                    { label: t("project:import-novel-4"), value: "novel" },
                                    { label: t("project:paste-text-2"), value: "text" },
                                ]}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item label={t("project:project-style-2")}>
                        <button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>
                            {selectedStyle ? (
                                <>
                                    <img src={selectedStyle.imageUrl} alt="" />
                                    <span>{selectedStyle.title}</span>
                                    <em>{t("project:replace-2")}</em>
                                </>
                            ) : (
                                <>
                                    <Palette className="size-4" />
                                    <span>{t("project:select-project-style-optional")}</span>
                                </>
                            )}
                        </button>
                    </Form.Item>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">{t("project:you-land-on-the-overview-after-creation-chapters-style-and-reference-ass")}</p>
                    <div className="flex justify-end gap-2">
                        <Button onClick={() => setCreateOpen(false)}>{t("project:cancel-4")}</Button>
                        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
                            {t("project:create-project-2")}
                        </Button>
                    </div>
                </Form>
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => {
                    setSelectedStyle(preset);
                    setStylePickerOpen(false);
                }}
            />
            <Modal className="library-modal" title={t("project:generate-chapters-with-ai-2")} open={generating} footer={null} closable={false} maskClosable={false} keyboard={false} width={760}>
                <div className="app-story-generating">
                    <div className="app-story-generating-head">
                        <span className="app-story-generating-mark">
                            <Sparkles className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <p>{t("project:ai-is-creating")}</p>
                            <span className="block text-[var(--fs-tiny)] text-foreground/45">{t("project:generating-title-synopsis-and-chapters")}</span>
                        </div>
                        {generateModel || effectiveConfig.textModel ? <span className="app-story-generating-model">{modelDisplayName(effectiveConfig, generateModel || effectiveConfig.textModel)}</span> : null}
                    </div>
                    <div className="app-story-generating-progress" aria-hidden="true" />
                    <div className="app-story-generating-grid">
                        <div className="app-story-generating-story">
                            <span className="app-story-generating-caption">{t("project:story-starting-point")}</span>
                            <p>{storyDraft.trim() || t("project:waiting-for-story-input")}</p>
                            <span className="app-story-generating-meta">
                                {generateChapterCount} {t("project:chapters-about")} {generateWordCount} {t("project:words-each")} {generateStructure} · {generatePerspective}
                            </span>
                            {selectedStyle ? (
                                <span className="app-story-generating-style">
                                    <img src={selectedStyle.imageUrl} alt="" />
                                    <span>{selectedStyle.title}</span>
                                </span>
                            ) : null}
                        </div>
                        <ol className="app-story-generating-steps">
                            {generationSteps.map((step) => {
                                const statusIndex = GENERATION_STEP_ORDER.indexOf(generationStatus as (typeof GENERATION_STEP_ORDER)[number]);
                                const stepIndex = GENERATION_STEP_ORDER.indexOf(step.key);
                                const state = stepIndex === statusIndex ? "is-active" : stepIndex < statusIndex ? "is-done" : "";
                                const label = t(step.labelKey);
                                return (
                                    <li key={step.key} className={state}>
                                        <span className="app-story-generating-step-dot" />
                                        <span>{label}</span>
                                        <em>{state === "is-active" ? t("project:in-progress") : state === "is-done" ? t("project:done-2") : t("project:waiting")}</em>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                    <div className="app-story-generating-preview">
                        <div className="app-story-generating-preview-head">
                            <span>{t("project:live-draft")}</span>
                            <span className="app-story-generating-live" />
                            <em>{generationPreview ? t("project:streaming-output") : t("project:waiting-for-model-output")}</em>
                        </div>
                        <pre>{generationPreview}</pre>
                    </div>
                </div>
            </Modal>
        </WorkspacePage>
    );
}

function parseGeneratedStory(answer: string) {
    const cleaned = answer
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const payload = match ? JSON.parse(match[0]) : {};
    const title = String(payload.title || "").trim();
    const synopsis = String(payload.synopsis || "").trim();
    const chapters = Array.isArray(payload.chapters)
        ? payload.chapters
              .map((chapter: unknown) => {
                  const item = typeof chapter === "object" && chapter ? (chapter as Record<string, unknown>) : {};
                  return { title: String(item.title || "").trim(), content: String(item.content || "").trim() };
              })
              .filter((chapter: { title: string; content: string }) => chapter.title && chapter.content)
        : [];
    return { title: title || storyTitleFromAnswer(answer), synopsis, chapters };
}

async function createUniqueProjectName(story: string, selectedStyle: CanvasStylePreset | null) {
    const base = story.trim().slice(0, 24);
    const buildInput = (name: string) => ({
        name,
        type: "short-drama" as const,
        aspectRatio: "9:16",
        sourceType: "blank",
        description: story.trim(),
        ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}),
    });
    let attempt = 0;
    for (;;) {
        try {
            return await createProject(buildInput(attempt === 0 ? base : `${base}（${attempt + 1}）`));
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const uniqueConflict = message.includes("UNIQUE") || message.includes("projects.user_id") || message.includes("projects.name");
            if (!uniqueConflict || attempt >= 5) throw error;
            attempt += 1;
        }
    }
}

function storyTitleFromAnswer(answer: string) {
    const line = answer.split(/\r?\n/).find((item) => item.trim());
    return line ? line.trim().slice(0, 24) : t("project:ai-generated-drama");
}

// 步骤状态用稳定 key 匹配，显示文案在渲染时经 t() 现取（禁止拿译文当状态比对）
const GENERATION_STEP_ORDER = ["creating", "outline", "importing"] as const;
const generationSteps = [
    { key: "creating", labelKey: "project:creating-project-2" },
    { key: "outline", labelKey: "project:ai-is-generating-outline-and-chapters" },
    { key: "importing", labelKey: "project:importing-chapters" },
] as const;

function ProjectRow({ row, onDelete }: { row: ProjectSummary; onDelete: () => void }) {
    const { t } = useTranslation("project");
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const projectStyle = resolveProjectCanvasStyle(row.project.stylePresetId, row.project.styleProfileJson);
    const styleTitle = projectStyle?.title || parseStyleProfile(row.project.styleProfileJson)?.title || resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? t("project:custom-style") : t("project:no-style-set"));
    const coverUrl = projectStyle?.imageUrl;
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="library-card project-library-card group">
            <span className="project-library-cover">
                {coverUrl ? (
                    <img className="project-library-cover-art" src={coverUrl} alt="" />
                ) : (
                    <span className="project-library-cover-icon">
                        <FolderKanban className="size-7" />
                    </span>
                )}
                <span className="project-library-cover-scrim" />
                <span className="project-library-cover-ratio">{row.project.aspectRatio}</span>
                <span className="project-library-cover-stage">{stage.label}</span>
                <button
                    type="button"
                    className="project-library-cover-delete"
                    title={t("project:delete-project")}
                    aria-label={t("project:delete-project-param", { name: row.project.name })}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDelete();
                    }}
                >
                    <Trash2 className="size-3.5" />
                </button>
            </span>
            <span className="project-library-body">
                <span className="project-library-heading">
                    <strong title={row.project.name}>{row.project.name}</strong>
                    {row.project.status === "archived" ? <em>{t("project:archived-2")}</em> : null}
                    <ArrowRight className="project-library-arrow size-4" />
                </span>
                <span className="project-library-subtitle">
                    {styleTitle} · {sourceTypeLabel(row.project.sourceType)}
                </span>
                <span className="project-library-progress">
                    <span>
                        <span>
                            {row.completedUnitCount}/{row.unitCount} {t("project:item-7")}
                        </span>
                        <span>{completion}%</span>
                    </span>
                    <i>
                        <b style={{ width: `${completion}%` }} />
                    </i>
                </span>
                <span className="project-library-stats">
                    <ProjectCount icon={<BookOpenText className="size-3.5" />} label={t("project:chapters-2")} value={row.unitCount} />
                    <ProjectCount icon={<LayoutGrid className="size-3.5" />} label={t("project:canvas-2")} value={row.canvasCount} />
                    <ProjectCount icon={<Images className="size-3.5" />} label={t("project:assets")} value={row.assetCount} />
                </span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return (
        <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}>
            <span className="text-foreground/32">{icon}</span>
            <strong className="font-medium tabular-nums text-foreground/65">{value}</strong>
            <span>{label}</span>
        </span>
    );
}
