import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Copy, Eye, Palette, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, UserRound } from "lucide-react";
import { App, Button, Input, Modal } from "antd";
import { nanoid } from "nanoid";

import { StyleProfileEditorModal } from "@/components/canvas/style-profile-editor-modal";
import { formatLocale } from "@/lib/format-locale";
import { canvasThemes } from "@/lib/canvas-theme";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { compileCanvasStylePreset, customCanvasStylePreset, recommendedCanvasStylePresets, type CanvasStylePreset, type ProjectStyleSelection } from "@/lib/canvas/canvas-style-system";
import { createStyleProfile, deleteStyleProfile, listStyleProfiles, setStyleProfileFavorite, touchStyleProfile, updateStyleProfile, type UserStyleProfile } from "@/services/api/style-profiles";
import { useThemeStore } from "@/stores/use-theme-store";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";
import { canvasStylePresets } from "@/lib/canvas/canvas-style-presets";

export { canvasStylePresets, resolveCanvasStylePreset, resolveProjectCanvasStyle } from "@/lib/canvas/canvas-style-presets";

// 分类过滤哨兵值：不与任何数据 category 文案耦合
const ALL_CATEGORY = "__all__";
export { type CanvasStylePreset } from "@/lib/canvas/canvas-style-system";

const STYLE_FAVORITES_KEY = "canvas:style-library:favorites";
const STYLE_RECENT_KEY = "canvas:style-library:recent";

type StyleCenterTab = "system" | "mine" | "favorites" | "recent";
type SystemStyleLibraryItem = { kind: "system"; preset: CanvasStylePreset };
type UserStyleLibraryItem = { kind: "user"; preset: CanvasStylePreset; entity: UserStyleProfile };
type StyleLibraryItem = SystemStyleLibraryItem | UserStyleLibraryItem;
type StyleEditorState = { profile: StyleProfileSnapshot; entityId?: string };

export function CanvasStylePickerModal({
    open,
    value,
    currentProfile,
    startInEditor = false,
    applying = false,
    onClose,
    onSelect,
}: {
    open: boolean;
    value?: string;
    currentProfile?: StyleProfileSnapshot | null;
    startInEditor?: boolean;
    applying?: boolean;
    onClose: () => void;
    onSelect: (preset: CanvasStylePreset) => void;
}) {
    const { t } = useTranslation("canvas");
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [detailPreset, setDetailPreset] = useState<CanvasStylePreset | null>(null);
    const [tab, setTab] = useState<StyleCenterTab>("system");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState(ALL_CATEGORY);
    const [systemFavoriteIds, setSystemFavoriteIds] = useState<string[]>([]);
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const [editor, setEditor] = useState<StyleEditorState | null>(null);
    const profilesQuery = useQuery({ queryKey: ["style-profiles"], queryFn: listStyleProfiles, enabled: open });

    useEffect(() => {
        if (!open) return;
        setTab("system");
        setQuery("");
        setCategory(t("canvas:all"));
        setSystemFavoriteIds(readStyleIds(STYLE_FAVORITES_KEY));
        setRecentIds(readStyleIds(STYLE_RECENT_KEY));
        setEditor(startInEditor && currentProfile?.source !== "user" && currentProfile ? { profile: editableCopy(currentProfile) } : null);
    }, [currentProfile, open, startInEditor]);

    const userItems = useMemo<UserStyleLibraryItem[]>(
        () =>
            (profilesQuery.data?.profiles || []).flatMap((entity) => {
                const preset = userStylePreset(entity);
                return preset ? [{ kind: "user" as const, preset, entity }] : [];
            }),
        [profilesQuery.data?.profiles],
    );
    const systemItems = useMemo<SystemStyleLibraryItem[]>(() => canvasStylePresets.map((preset) => ({ kind: "system", preset })), []);
    const categories = useMemo(() => [t("canvas:all"), ...Array.from(new Set(canvasStylePresets.map((preset) => preset.category)))], []);

    useEffect(() => {
        if (!open || !startInEditor || !currentProfile || currentProfile.source !== "user" || editor || profilesQuery.isFetching || profilesQuery.isError) return;
        const sourceId = currentProfile.sourceProfileId || currentProfile.presetId;
        const sourceEntity = (profilesQuery.data?.profiles || []).find((profile) => profile.id === sourceId);
        const sourceProfile = sourceEntity ? parseStyleProfile(sourceEntity.profileJson) : null;
        if (sourceEntity && sourceProfile) {
            setEditor({ profile: editableCopy(sourceProfile, sourceEntity.id), entityId: sourceEntity.id });
            return;
        }
        if (profilesQuery.isFetched) setEditor({ profile: editableCopy(currentProfile) });
    }, [currentProfile, editor, open, profilesQuery.data?.profiles, profilesQuery.isError, profilesQuery.isFetched, profilesQuery.isFetching, startInEditor]);

    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase(formatLocale());
        let source: StyleLibraryItem[] =
            tab === "system"
                ? systemItems
                : tab === "mine"
                  ? userItems
                  : tab === "favorites"
                    ? [...systemItems.filter((item) => systemFavoriteIds.includes(item.preset.id)), ...userItems.filter((item) => item.kind === "user" && item.entity.favorite)]
                    : [
                          ...userItems.filter((item) => item.kind === "user" && item.entity.lastUsedAt).sort((a, b) => String(b.entity.lastUsedAt).localeCompare(String(a.entity.lastUsedAt))),
                          ...recentIds.flatMap((id) => systemItems.filter((item) => item.preset.id === id)),
                      ];
        if (tab === "system" && category !== ALL_CATEGORY) source = source.filter((item) => item.preset.category === category);
        if (keyword) source = source.filter((item) => `${item.preset.title} ${item.preset.category} ${item.preset.description} ${item.preset.tags.join(" ")}`.toLocaleLowerCase(formatLocale()).includes(keyword));
        return source;
    }, [category, query, recentIds, systemFavoriteIds, systemItems, tab, userItems]);

    const saveMutation = useMutation({
        mutationFn: ({ profile, apply }: { profile: StyleProfileSnapshot; apply: boolean }) =>
            editor?.entityId ? updateStyleProfile(editor.entityId, serializeStyleProfile(profile)).then((result) => ({ ...result, apply })) : createStyleProfile(serializeStyleProfile(profile)).then((result) => ({ ...result, apply })),
        onSuccess: async ({ profile, apply }) => {
            await queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
            const preset = userStylePreset(profile);
            setEditor(null);
            setTab("mine");
            message.success(t("canvas:style-saved-to-my-styles"));
            if (apply && preset) selectItem({ kind: "user", preset, entity: profile });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas:failed-to-save-style")),
    });
    const favoriteMutation = useMutation({
        mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => setStyleProfileFavorite(id, favorite),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["style-profiles"] }),
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas:failed-to-update-favorite-status")),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteStyleProfile,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
            message.success(t("canvas:style-deleted"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t("canvas:failed-to-delete-style")),
    });

    function selectItem(item: StyleLibraryItem) {
        if (applying) return;
        const { preset } = item;
        const next = [preset.id, ...recentIds.filter((id) => id !== preset.id)].slice(0, 12);
        setRecentIds(next);
        localStorage.setItem(STYLE_RECENT_KEY, JSON.stringify(next));
        if (item.kind === "user")
            void touchStyleProfile(item.entity.id)
                .then(() => queryClient.invalidateQueries({ queryKey: ["style-profiles"] }))
                .catch((error) => message.warning(error instanceof Error ? error.message : t("canvas:failed-to-update-recent-usage")));
        onSelect(preset);
    }
    function toggleSystemFavorite(presetId: string) {
        const next = systemFavoriteIds.includes(presetId) ? systemFavoriteIds.filter((id) => id !== presetId) : [presetId, ...systemFavoriteIds];
        setSystemFavoriteIds(next);
        localStorage.setItem(STYLE_FAVORITES_KEY, JSON.stringify(next));
    }
    function createNewStyle() {
        setEditor({ profile: blankUserStyle() });
    }
    function copyPreset(preset: CanvasStylePreset) {
        setEditor({ profile: editableCopy(preset.profile || createStyleProfileSnapshot(preset), undefined, t("canvas:param-copy", { title: preset.title }), preset.imageUrl) });
    }
    function confirmDelete(entity: UserStyleProfile) {
        modal.confirm({
            title: t("canvas:delete-param-2", { name: entity.name }),
            content: t("canvas:existing-saved-snapshots-are-not-deleted-but-the-style-is-removed-from-m"),
            okText: t("canvas:delete-5"),
            cancelText: t("canvas:cancel-11"),
            okButtonProps: { danger: true },
            onOk: () => deleteMutation.mutateAsync(entity.id),
        });
    }

    return (
        <>
            <Modal rootClassName="canvas-style-picker-modal" open={open} title={null} footer={null} centered width="min(1240px, calc(100vw - 24px))" onCancel={onClose} styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
                <div className="canvas-style-center-shell flex min-h-0 flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                    <header className="flex min-h-16 flex-col gap-3 border-b px-4 py-3 pr-12 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pr-14" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold">{t("canvas:style-center-2")}</h2>
                            <p className="mt-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                {t("canvas:system-specs-personal-styles-project-snapshots-2")}
                            </p>
                        </div>
                        <div className="flex min-w-0 gap-2 sm:items-center">
                            <Input
                                allowClear
                                className="style-center-search min-w-0 flex-1"
                                prefix={<Search className="size-3.5 text-foreground/35" />}
                                value={query}
                                placeholder={t("canvas:search-styles-genres-or-media")}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            <Button type="primary" className="shrink-0" icon={<Plus className="size-3.5" />} onClick={createNewStyle}>
                                {t("canvas:new-style-4")}
                            </Button>
                        </div>
                    </header>
                    <div className="style-center-workspace grid min-h-0 flex-1">
                        <aside className="style-center-sidebar thin-scrollbar min-h-0 overflow-auto border-b p-2 sm:p-3 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.stroke }}>
                            <nav className="style-center-primary-nav flex gap-1 lg:flex-col" aria-label={t("canvas:style-center-view")}>
                                <StyleCenterNavItem active={tab === "system"} icon={<Palette className="size-3.5" />} label={t("canvas:system-styles")} count={systemItems.length} onClick={() => setTab("system")} />
                                <StyleCenterNavItem active={tab === "mine"} icon={<UserRound className="size-3.5" />} label={t("canvas:my-styles-3")} count={userItems.length} onClick={() => setTab("mine")} />
                                <StyleCenterNavItem active={tab === "favorites"} icon={<Star className="size-3.5" />} label={t("canvas:favorite")} onClick={() => setTab("favorites")} />
                                <StyleCenterNavItem active={tab === "recent"} icon={<Clock3 className="size-3.5" />} label={t("canvas:recent")} onClick={() => setTab("recent")} />
                            </nav>
                            {tab === "system" ? (
                                <div className="style-center-category-panel mt-2 border-t pt-2 lg:mt-4 lg:pt-3" style={{ borderColor: theme.node.stroke }}>
                                    <div className="hidden px-2 pb-1.5 text-[var(--fs-tiny)] font-medium lg:block" style={{ color: theme.node.muted }}>
                                        {t("canvas:categories-2")}
                                    </div>
                                    <nav className="style-center-category-nav flex gap-1 lg:flex-col" aria-label={t("canvas:system-style-categories")}>
                                        {categories.map((item) => (
                                            <button
                                                key={item}
                                                type="button"
                                                aria-current={category === item ? "page" : undefined}
                                                className={`style-center-category-item h-9 shrink-0 rounded-md px-2.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 ${category === item ? "is-active font-medium" : ""}`}
                                                onClick={() => setCategory(item)}
                                            >
                                                {item}
                                            </button>
                                        ))}
                                    </nav>
                                </div>
                            ) : null}
                        </aside>
                        <main className="flex min-h-0 min-w-0 flex-col">
                            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4" style={{ borderColor: theme.node.stroke }}>
                                <div className="min-w-0 truncate text-xs font-medium">{styleCenterViewTitle(tab, category)}</div>
                                <div className="shrink-0 text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>
                                    {visibleItems.length} {t("canvas:styles-3")}
                                </div>
                            </div>
                            <div className="style-center-grid thin-scrollbar min-h-0 flex-1 content-start overflow-y-auto p-3 sm:p-4">
                                {visibleItems.map((item) => (
                                    <StyleCenterCard
                                        key={`${item.kind}-${item.preset.id}`}
                                        item={item}
                                        active={item.preset.id === value}
                                        applying={applying}
                                        favorite={item.kind === "user" ? item.entity.favorite : systemFavoriteIds.includes(item.preset.id)}
                                        theme={theme}
                                        onApply={() => selectItem(item)}
                                        onDetail={() => setDetailPreset(item.preset)}
                                        onFavorite={() => (item.kind === "user" ? favoriteMutation.mutate({ id: item.entity.id, favorite: !item.entity.favorite }) : toggleSystemFavorite(item.preset.id))}
                                        onCopy={() => copyPreset(item.preset)}
                                        onEdit={item.kind === "user" ? () => setEditor({ profile: editableCopy(item.preset.profile!, item.entity.id), entityId: item.entity.id }) : undefined}
                                        onDelete={item.kind === "user" ? () => confirmDelete(item.entity) : undefined}
                                    />
                                ))}
                                {!visibleItems.length ? (
                                    <EmptyStyleCenter
                                        tab={tab}
                                        loading={profilesQuery.isLoading}
                                        failed={profilesQuery.isError}
                                        color={theme.node.muted}
                                        onCreate={createNewStyle}
                                        onBrowse={() => {
                                            setTab("system");
                                            setQuery("");
                                        }}
                                    />
                                ) : null}
                            </div>
                        </main>
                    </div>
                </div>
            </Modal>
            <CanvasStyleDetailModal
                open={Boolean(detailPreset)}
                preset={detailPreset}
                selected={detailPreset?.id === value}
                onClose={() => setDetailPreset(null)}
                onSelect={(preset) => {
                    setDetailPreset(null);
                    const item = [...systemItems, ...userItems].find((candidate) => candidate.preset.id === preset.id);
                    if (item) selectItem(item);
                }}
            />
            <StyleProfileEditorModal open={Boolean(editor)} initialProfile={editor?.profile || null} saving={saveMutation.isPending} onClose={() => setEditor(null)} onSave={(profile, apply) => saveMutation.mutate({ profile, apply })} />
        </>
    );
}

function readStyleIds(key: string) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 100) : [];
    } catch {
        return [];
    }
}

function StyleCenterCard({
    item,
    active,
    applying,
    favorite,
    theme,
    onApply,
    onDetail,
    onFavorite,
    onCopy,
    onEdit,
    onDelete,
}: {
    item: StyleLibraryItem;
    active: boolean;
    applying: boolean;
    favorite: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onApply: () => void;
    onDetail: () => void;
    onFavorite: () => void;
    onCopy: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
}) {
    const { t } = useTranslation("canvas");
    const { preset } = item;
    return (
        <article
            className={`style-center-card group flex min-w-0 flex-col overflow-hidden rounded-md border ${active ? "is-active" : ""}`}
            style={{ background: theme.canvas.background, borderColor: active ? theme.node.activeStroke : theme.node.stroke, boxShadow: active ? `inset 0 0 0 1px ${theme.node.activeStroke}` : undefined }}
        >
            <div className="relative overflow-hidden border-b" style={{ borderColor: theme.node.stroke }}>
                <button
                    type="button"
                    className="style-center-card-cover block w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    style={{ "--tw-ring-color": theme.node.activeStroke } as CSSProperties}
                    onClick={onDetail}
                    aria-label={t("canvas:view-spec-param", { title: preset.title })}
                >
                    <img src={preset.imageUrl} width="640" height="360" alt={t("canvas:style-preview-param", { title: preset.title })} className="h-full w-full object-cover transition-transform" />
                </button>
                <button
                    type="button"
                    className={`style-center-favorite-action absolute right-2 top-2 grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${favorite ? "is-active" : ""}`}
                    onClick={onFavorite}
                    aria-label={favorite ? t("canvas:remove-favorite") : t("canvas:favorite")}
                    title={favorite ? t("canvas:remove-favorite") : t("canvas:favorite")}
                >
                    <Star className="size-3.5" fill={favorite ? "currentColor" : "none"} />
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
                <div className="flex min-w-0 items-center gap-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                    <span className="truncate">{item.kind === "user" ? t("canvas:my-styles-3") : preset.category}</span>
                    {active ? (
                        <span className="ml-auto flex shrink-0 items-center gap-1 font-medium" style={{ color: theme.node.activeStroke }}>
                            <Check className="size-3" />
                            {t("canvas:current-4")}
                        </span>
                    ) : null}
                </div>
                <h3 className="mt-1.5 truncate text-sm font-semibold">{preset.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                    {preset.description}
                </p>
                <div className="mt-2 flex min-h-6 flex-wrap gap-1">
                    {preset.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                            {tag}
                        </span>
                    ))}
                </div>
            </div>
            <footer className="mt-2 flex min-h-11 items-center gap-1 border-t px-2" style={{ borderColor: theme.node.stroke }}>
                <IconAction label={t("canvas:view-spec")} onClick={onDetail}>
                    <Eye className="size-3.5" />
                </IconAction>
                <IconAction label={t("canvas:duplicate-and-edit")} onClick={onCopy}>
                    <Copy className="size-3.5" />
                </IconAction>
                {onEdit ? (
                    <IconAction label={t("canvas:edit-style")} onClick={onEdit}>
                        <Pencil className="size-3.5" />
                    </IconAction>
                ) : null}
                {onDelete ? (
                    <IconAction label={t("canvas:delete-style")} danger onClick={onDelete}>
                        <Trash2 className="size-3.5" />
                    </IconAction>
                ) : null}
                <Button
                    type="default"
                    size="small"
                    className={`style-center-apply-button ml-auto ${active ? "is-current" : ""}`}
                    disabled={active || applying}
                    icon={active ? <Check className="size-3.5" /> : <Palette className="size-3.5" />}
                    onClick={onApply}
                >
                    {active ? t("canvas:current-4") : t("canvas:apply-3")}
                </Button>
            </footer>
        </article>
    );
}

function IconAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className={`style-center-icon-action grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${danger ? "is-danger" : ""}`} onClick={onClick} aria-label={label} title={label}>
            {children}
        </button>
    );
}

function StyleCenterNavItem({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-current={active ? "page" : undefined}
            className={`style-center-nav-item flex h-11 min-w-fit items-center gap-2 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 lg:w-full ${active ? "is-active font-medium" : ""}`}
            onClick={onClick}
        >
            {icon}
            <span className="whitespace-nowrap">{label}</span>
            {count !== undefined ? <span className="ml-auto tabular-nums opacity-55">{count}</span> : null}
        </button>
    );
}

function styleCenterViewTitle(tab: StyleCenterTab, category: string) {
    if (tab === "mine") return t("canvas:my-styles-3");
    if (tab === "favorites") return t("canvas:favorite-2");
    if (tab === "recent") return t("canvas:recent");
    return category === ALL_CATEGORY ? t("canvas:all-system-styles") : category;
}

function EmptyStyleCenter({ tab, loading, failed, color, onCreate, onBrowse }: { tab: StyleCenterTab; loading: boolean; failed: boolean; color: string; onCreate: () => void; onBrowse: () => void }) {
    return (
        <div className="col-span-full grid min-h-64 place-items-center text-center">
            <div>
                <Search className="mx-auto size-5" style={{ color }} />
                <p className="mt-2 text-xs font-medium">
                    {loading
                        ? t("canvas:loading-style-library")
                        : failed && tab !== "system"
                          ? t("canvas:failed-to-load-my-styles-check-your-sign-in-status-or-backend-service")
                          : tab === "mine"
                            ? t("canvas:no-personal-styles-yet")
                            : tab === "favorites"
                              ? t("canvas:no-favorites-yet")
                              : tab === "recent"
                                ? t("canvas:no-usage-history-yet")
                                : t("canvas:no-matching-system-styles")}
                </p>
                <div className="mt-3 flex justify-center gap-2">
                    {tab === "mine" && !failed ? (
                        <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreate}>
                            {t("canvas:new-style-4")}
                        </Button>
                    ) : null}
                    <Button size="small" onClick={onBrowse}>
                        {t("canvas:browse-system-styles-2")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function userStylePreset(entity: UserStyleProfile): CanvasStylePreset | null {
    const profile = parseStyleProfile(entity.profileJson);
    if (!profile) return null;
    return {
        id: profile.presetId,
        title: profile.title,
        category: t("canvas:my-styles-3"),
        description: profile.description,
        tags: [...profile.tags],
        prompt: profile.prompt,
        imageUrl: profile.coverUrl || entity.coverUrl || "/short-drama-styles/real-life.jpg",
        profile,
    };
}

function blankUserStyle(): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ presetId: `draft-${nanoid()}`, title: t("canvas:untitled-style"), description: "", tags: [], prompt: "", assets: [], source: "user", revision: 1 });
}

function editableCopy(profile: StyleProfileSnapshot, entityId?: string, title?: string, coverUrl?: string): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ ...profile, presetId: entityId || `draft-${nanoid()}`, sourceProfileId: entityId, title: title || profile.title, coverUrl: profile.coverUrl || coverUrl, source: "user", revision: entityId ? profile.revision : 1 });
}

export function CanvasStyleDetailModal({ open, preset, selected = false, onClose, onSelect }: { open: boolean; preset: CanvasStylePreset | null; selected?: boolean; onClose: () => void; onSelect?: (preset: CanvasStylePreset) => void }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sections = preset ? parseStyleSections(preset.prompt) : [];
    return (
        <Modal rootClassName="canvas-style-detail-modal" open={open} title={null} footer={null} centered destroyOnHidden width="min(820px, calc(100vw - 24px))" onCancel={onClose} styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
            {preset ? (
                <div className="canvas-style-detail-shell flex flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                    <div className="flex h-44 shrink-0 items-center justify-center overflow-hidden border-b sm:h-52" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                        <img
                            src={preset.imageUrl}
                            width="960"
                            height="540"
                            alt={t("canvas:style-preview-param", { title: preset.title })}
                            className="h-full w-full object-contain"
                            style={preset.id === "black-white-noir" ? { filter: "grayscale(1) contrast(1.08)" } : undefined}
                        />
                    </div>
                    <header className="border-b px-4 py-3 pr-12 sm:px-5 sm:pr-12" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center gap-2 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.activeStroke }}>
                            <span>{preset.category}</span>
                            <span className="flex items-center gap-1" style={{ color: theme.node.muted }}>
                                <SlidersHorizontal className="size-3" />
                                {preset.profile?.assets.length ? t("canvas:param-execution-assets", { length: preset.profile.assets.length }) : t("canvas:prompt-generic")}
                            </span>
                        </div>
                        <h2 className="mt-1 text-base font-semibold">{preset.title}</h2>
                        <p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>
                            {preset.description}
                        </p>
                    </header>
                    <div className="grid shrink-0 grid-cols-3 divide-x border-b text-[var(--fs-tiny)]" style={{ borderColor: theme.node.stroke }}>
                        <StyleDetailMetric label={t("canvas:execution-mode")} value={preset.profile?.assets.length ? t("canvas:combined-assets") : t("canvas:prompt-generic")} muted={theme.node.muted} />
                        <StyleDetailMetric label={t("canvas:execution-policy-2")} value={preset.profile?.executionPolicy === "strict-assets" ? t("canvas:strict-validation") : t("canvas:graceful-fallback")} muted={theme.node.muted} />
                        <StyleDetailMetric label={t("canvas:snapshot-version")} value={`r${preset.profile?.revision || 1}`} muted={theme.node.muted} />
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5">
                        {preset.profile?.assets.length ? (
                            <section className="border-b py-3" style={{ borderColor: theme.node.stroke }}>
                                <h3 className="text-xs font-semibold">{t("canvas:execution-assets-5")}</h3>
                                <div className="mt-2 divide-y" style={{ borderColor: theme.node.stroke }}>
                                    {preset.profile.assets.map((asset) => (
                                        <div key={asset.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                                            <span className="min-w-0">
                                                <span className="block truncate font-medium">{asset.title}</span>
                                                <span className="mt-0.5 block text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                                    {kindOptionsLabel(asset.kind)} · {asset.provider}
                                                </span>
                                            </span>
                                            <span className="shrink-0 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                                {asset.status === "validated" ? t("canvas:validated") : asset.status === "unavailable" ? t("canvas:unavailable") : t("canvas:pending-validation")}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {sections.map((section) => (
                            <section key={section.title} className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}>
                                <h3 className="text-xs font-semibold">{section.title}</h3>
                                <p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {section.content}
                                </p>
                            </section>
                        ))}
                        {preset.profile?.negativePrompt ? (
                            <section className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}>
                                <h3 className="text-xs font-semibold">{t("canvas:global-negative-prompt-2")}</h3>
                                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {preset.profile.negativePrompt}
                                </p>
                            </section>
                        ) : null}
                    </div>
                    <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: theme.node.stroke }}>
                        <Button onClick={onClose}>{t("canvas:close-2")}</Button>
                        {onSelect ? (
                            <Button type="primary" disabled={selected} icon={selected ? <Check className="size-3.5" /> : <Palette className="size-3.5" />} onClick={() => onSelect(preset)}>
                                {selected ? t("canvas:current-style") : t("canvas:use-this-style")}
                            </Button>
                        ) : null}
                    </footer>
                </div>
            ) : null}
        </Modal>
    );
}

function StyleDetailMetric({ label, value, muted }: { label: string; value: string; muted: string }) {
    return (
        <div className="min-w-0 px-3 py-2.5 text-center">
            <span className="block" style={{ color: muted }}>
                {label}
            </span>
            <span className="mt-0.5 block truncate font-medium">{value}</span>
        </div>
    );
}

function kindOptionsLabel(kind: string) {
    return kind === "lora" ? "LoRA" : kind === "template" ? t("canvas:image-template") : kind === "reference" ? t("canvas:reference-image-set") : t("canvas:prompt-modules");
}

function parseStyleSections(prompt: string) {
    return prompt
        .split("\n")
        .map((line) => {
            const match = line.match(/^【([^】]+)】(.*)$/);
            return match ? { title: match[1], content: match[2] } : { title: t("canvas:supplementary-spec"), content: line };
        })
        .filter((section) => section.content);
}
