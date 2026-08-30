import { App, Button, Input, Skeleton, type InputRef } from "antd";
import { AlertTriangle, Brush, KeyRound, RefreshCw, RotateCcw, Save, Shapes } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { drawingEngineLabel, isDrawingEngineAvailable, type CanvasDrawingEngine, type CanvasDrawingEngineSetting } from "@/lib/canvas/canvas-drawing-engine";
import { cn } from "@/lib/utils";
import { getAdminDrawingEngineSetting, updateAdminDrawingEngineSetting } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

type DrawingEngineDraft = {
    defaultEngine: CanvasDrawingEngine;
    tldrawLicenseKey: string;
};

const engineOptions: Array<{
    value: CanvasDrawingEngine;
    title: string;
    description: string;
}> = [
    {
        value: "excalidraw",
        title: "Excalidraw",
        description: "无需授权，适合草图、结构标注和轻量协作。",
    },
    {
        value: "tldraw",
        title: "tldraw",
        description: "需要浏览器端 License Key，也用于打开已有 tldraw 绘图。",
    },
];

export default function DrawingEngineSettingsPage() {
    const { message, modal } = App.useApp();
    const setDrawingEngine = useUserStore((state) => state.setDrawingEngine);
    const [savedSetting, setSavedSetting] = useState<CanvasDrawingEngineSetting | null>(null);
    const [draft, setDraft] = useState<DrawingEngineDraft | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);
    const licenseInputRef = useRef<InputRef>(null);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminDrawingEngineSetting();
                const setting = parseDrawingEngineSetting(result.setting);
                if (requestVersion !== requestVersionRef.current) return;
                setSavedSetting(setting);
                setDraft(toDraft(setting));
                setDrawingEngine(setting);
                setSaveError("");
                if (announce) message.success("已重新读取当前绘图工具配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取绘图工具配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message, setDrawingEngine],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    const normalizedDraft = draft ? normalizeDraft(draft) : null;
    const dirtyFields = useMemo(() => {
        if (!savedSetting || !normalizedDraft) return [];
        const fields: Array<"defaultEngine" | "tldrawLicenseKey"> = [];
        if (savedSetting.defaultEngine !== normalizedDraft.defaultEngine) fields.push("defaultEngine");
        if ((savedSetting.tldrawLicenseKey || "").trim() !== normalizedDraft.tldrawLicenseKey) fields.push("tldrawLicenseKey");
        return fields;
    }, [normalizedDraft, savedSetting]);
    const dirty = dirtyFields.length > 0;
    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃绘图工具调整？",
            content: `当前有 ${dirtyFields.length} 项调整尚未保存，离开后暂存内容会丢失。`,
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                navigationTriggerRef.current = null;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
                window.requestAnimationFrame(() => {
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-drawing-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, dirtyFields.length, modal]);

    const tldrawAvailable = draft ? isDrawingEngineAvailable("tldraw", draft.tldrawLicenseKey) : false;
    const draftHasStoredLicense = Boolean(normalizedDraft?.tldrawLicenseKey);
    const usingEnvironmentLicense = tldrawAvailable && !draftHasStoredLicense;
    const selectedEngineAvailable = draft ? isDrawingEngineAvailable(draft.defaultEngine, draft.tldrawLicenseKey) : false;

    const resetDraft = () => {
        if (!savedSetting || saving) return;
        setDraft(toDraft(savedSetting));
        setSaveError("");
        message.info("已撤销本页尚未保存的调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: `当前有 ${dirtyFields.length} 项调整尚未保存。重新读取会丢弃暂存内容，并以服务端当前配置为准。`,
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const selectEngine = (engine: CanvasDrawingEngine) => {
        if (!draft || saving) return;
        setDraft({ ...draft, defaultEngine: engine });
        setSaveError("");
    };

    async function save(override?: DrawingEngineDraft) {
        const expected = normalizeDraft(override || draft || { defaultEngine: "excalidraw", tldrawLicenseKey: "" });
        const hasChanges = Boolean(savedSetting && (savedSetting.defaultEngine !== expected.defaultEngine || (savedSetting.tldrawLicenseKey || "").trim() !== expected.tldrawLicenseKey));
        if (!savedSetting || !hasChanges || saving) return;
        if (!isDrawingEngineAvailable(expected.defaultEngine, expected.tldrawLicenseKey)) {
            setSaveError("当前选择的 tldraw 不可用，请先配置授权或改用 Excalidraw。");
            licenseInputRef.current?.focus();
            throw new Error("请先配置 tldraw License Key");
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminDrawingEngineSetting(expected);
            const setting = parseDrawingEngineSetting(result.setting);
            if (setting.defaultEngine !== expected.defaultEngine || (setting.tldrawLicenseKey || "").trim() !== expected.tldrawLicenseKey) {
                throw new Error("服务端返回的绘图工具配置与本次保存内容不一致，请重新读取后核对");
            }
            setSavedSetting(setting);
            setDraft(toDraft(setting));
            setDrawingEngine(setting);
            message.success("绘图工具配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存绘图工具配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    }

    const submitSave = async () => {
        try {
            await save();
        } catch {
            // 校验或保存错误已在 save 中就地提示。
        }
    };

    if (loading && !draft) {
        return (
            <AdminPageFrame title="绘图工具" description="管理新建绘图的默认编辑器与 tldraw 授权" scroll>
                <div className="admin-settings-stack admin-drawing-settings" aria-label="正在读取绘图工具配置" role="status">
                    <div className="admin-drawing-command-bar">
                        <Skeleton active title={{ width: 180 }} paragraph={false} />
                    </div>
                    <div className="admin-drawing-loading-card">
                        <Skeleton active paragraph={{ rows: 5 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!draft || !savedSetting) {
        return (
            <AdminPageFrame title="绘图工具" description="管理新建绘图的默认编辑器与 tldraw 授权" scroll>
                <div className="admin-settings-stack admin-drawing-settings">
                    <div className="admin-drawing-load-error" role="alert">
                        <span className="admin-drawing-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取绘图工具配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load(true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    const licenseStatus = draftHasStoredLicense ? "后台已配置" : usingEnvironmentLicense ? "部署环境提供" : "未配置";

    return (
        <AdminPageFrame title="绘图工具" description="管理新建绘图的默认编辑器与 tldraw 授权" scroll>
            <div className="admin-settings-stack admin-drawing-settings">
                <div className={cn("admin-drawing-command-bar", dirty && "is-dirty")}>
                    <div className="admin-drawing-command-copy" aria-live="polite">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{dirty ? `${dirtyFields.length} 项调整待保存` : "绘图工具配置已同步"}</strong>
                            <AdminStatusBadge label={dirty ? "尚未生效" : savedSetting.configured ? "服务端配置" : "系统默认"} tone={dirty ? "warning" : "neutral"} />
                        </div>
                    </div>
                    <div className="admin-drawing-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                撤销改动
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            刷新状态
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || !selectedEngineAvailable} onClick={() => void submitSave()}>
                            保存修改
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-drawing-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <div className="admin-drawing-section-grid">
                    <div id="admin-drawing-default-engine" className="admin-settings-anchor">
                        <SettingsSectionCard
                            icon={<Brush className="size-4" aria-hidden="true" />}
                            title="1. 选择新建绘图默认编辑器"
                            description="仅影响之后新建的绘图，不转换已有节点。"
                            status={<AdminStatusBadge label={drawingEngineLabel(draft.defaultEngine)} tone={selectedEngineAvailable ? "info" : "warning"} />}
                        >
                            <div className="admin-drawing-engine-grid" role="group" aria-label="选择新建绘图默认编辑器">
                                {engineOptions.map((option) => {
                                    const available = isDrawingEngineAvailable(option.value, draft.tldrawLicenseKey);
                                    const selected = draft.defaultEngine === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={cn("admin-drawing-engine-choice", selected && "is-selected", !available && "is-unavailable")}
                                            aria-label={`选择 ${option.title} 作为新建绘图默认编辑器${available ? "" : "，保存前需要配置授权"}`}
                                            aria-pressed={selected}
                                            disabled={saving}
                                            onClick={() => selectEngine(option.value)}
                                        >
                                            <span className="admin-drawing-engine-choice-heading">
                                                <span className="admin-drawing-engine-choice-icon">{option.value === "excalidraw" ? <Shapes className="size-4" aria-hidden="true" /> : <Brush className="size-4" aria-hidden="true" />}</span>
                                                <span className="min-w-0 flex-1">
                                                    <strong>{option.title}</strong>
                                                </span>
                                                <AdminStatusBadge label={selected ? "已选择" : available ? "可用" : "需要授权"} tone={selected ? "info" : available ? "success" : "warning"} />
                                            </span>
                                            <span className="admin-drawing-engine-choice-description">{option.description}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </SettingsSectionCard>
                    </div>

                    <div id="admin-drawing-tldraw-license" className="admin-settings-anchor">
                        <SettingsSectionCard
                            icon={<KeyRound className="size-4" aria-hidden="true" />}
                            title="2. 配置 tldraw 授权（按需）"
                            description="选择 tldraw 或需要打开已有 tldraw 绘图时配置。"
                            status={<AdminStatusBadge label={licenseStatus} tone={tldrawAvailable ? "success" : "warning"} />}
                        >
                            <div className="admin-drawing-license-layout">
                                <div className="admin-drawing-license-field">
                                    <label htmlFor="admin-tldraw-license-key">tldraw License Key</label>
                                    <Input.Password
                                        ref={licenseInputRef}
                                        id="admin-tldraw-license-key"
                                        value={draft.tldrawLicenseKey}
                                        onChange={(event) => {
                                            setDraft({ ...draft, tldrawLicenseKey: event.target.value });
                                            setSaveError("");
                                        }}
                                        placeholder="输入用于浏览器端的 tldraw License Key"
                                        disabled={saving}
                                        autoComplete="new-password"
                                        aria-describedby="admin-tldraw-license-help"
                                    />
                                    <p id="admin-tldraw-license-help">留空时使用部署环境授权；两处都未配置时 tldraw 不可用。</p>
                                </div>
                            </div>
                        </SettingsSectionCard>
                    </div>
                </div>
            </div>
        </AdminPageFrame>
    );
}

function toDraft(setting: CanvasDrawingEngineSetting): DrawingEngineDraft {
    return {
        defaultEngine: setting.defaultEngine,
        tldrawLicenseKey: setting.tldrawLicenseKey || "",
    };
}

function normalizeDraft(draft: DrawingEngineDraft): DrawingEngineDraft {
    return {
        defaultEngine: draft.defaultEngine,
        tldrawLicenseKey: draft.tldrawLicenseKey.trim(),
    };
}

function parseDrawingEngineSetting(value: unknown): CanvasDrawingEngineSetting {
    if (!value || typeof value !== "object") throw new Error("绘图工具配置响应格式无效");
    const record = value as Record<string, unknown>;
    if (record.defaultEngine !== "excalidraw" && record.defaultEngine !== "tldraw") throw new Error("绘图工具配置缺少有效的默认编辑器");
    if (record.tldrawLicenseKey !== undefined && typeof record.tldrawLicenseKey !== "string") throw new Error("绘图工具配置中的 tldraw 授权格式无效");
    return {
        defaultEngine: record.defaultEngine,
        tldrawLicenseKey: typeof record.tldrawLicenseKey === "string" ? record.tldrawLicenseKey : "",
        configured: typeof record.configured === "boolean" ? record.configured : undefined,
        updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : undefined,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
}
