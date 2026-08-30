import { App, Button, Input, Skeleton, Switch } from "antd";
import { AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, Eye, ListOrdered, Plus, RefreshCw, RotateCcw, Save, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminResponseInterceptionSetting, updateAdminResponseInterceptionSetting, type ResponseInterceptionRule, type ResponseInterceptionSetting } from "@/services/api/response-interception";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

const MAX_RULES = 100;
const MAX_MATCH_RUNES = 200;
const MAX_REPLACE_RUNES = 500;
const emptyRule = (): ResponseInterceptionRule => ({ contains: "", replace: "" });

export default function ResponseInterceptionSettingsPage() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<ResponseInterceptionSetting | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [rules, setRules] = useState<ResponseInterceptionRule[]>([]);
    const [previewInput, setPreviewInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);
    const draft = useMemo(() => normalizeResponseInterceptionSetting({ enabled, rules }), [enabled, rules]);
    const dirty = useMemo(() => Boolean(setting && !responseInterceptionSettingsEqual(draft, setting)), [draft, setting]);
    const enabledDirty = Boolean(setting && enabled !== setting.enabled);
    const duplicateRuleIndexes = useMemo(() => findDuplicateRuleIndexes(draft.rules), [draft.rules]);
    const preview = useMemo(() => previewResponseInterception(previewInput, draft), [draft, previewInput]);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminResponseInterceptionSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isResponseInterceptionSetting(result.setting)) throw new Error("服务端返回的模型响应拦截配置格式无效");
                setSetting(normalizeResponseInterceptionSetting(result.setting));
                setEnabled(result.setting.enabled);
                setRules(result.setting.rules.map((rule) => ({ ...rule })));
                setSaveError("");
                if (announce) message.success("已重新读取模型响应拦截配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取模型响应拦截配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

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
            title: "放弃响应拦截调整？",
            content: "当前页面有尚未保存的开关、规则内容或优先级调整，离开后这些草稿会丢失。服务端正在使用的拦截配置不会改变。",
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
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-intercept-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        setEnabled(setting.enabled);
        setRules(setting.rules.map((rule) => ({ ...rule })));
        setSaveError("");
        message.info("已撤销模型响应拦截的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前开关、规则内容和优先级草稿，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const updateRule = (index: number, field: keyof ResponseInterceptionRule, value: string) => {
        setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, [field]: value } : rule)));
        setSaveError("");
    };

    const moveRule = (index: number, offset: -1 | 1) => {
        setRules((current) => {
            const target = index + offset;
            if (target < 0 || target >= current.length) return current;
            const next = current.map((rule) => ({ ...rule }));
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
        setSaveError("");
    };

    const removeRule = (index: number) => {
        setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
        setSaveError("");
    };

    const addRule = () => {
        if (rules.length >= MAX_RULES) {
            message.warning(`模型响应拦截规则不能超过 ${MAX_RULES} 条`);
            return;
        }
        setRules((current) => [...current, emptyRule()]);
        setSaveError("");
        window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[aria-label="第 ${rules.length + 1} 条匹配文案"]`)?.focus());
    };

    const save = async (next?: ResponseInterceptionSetting) => {
        if (!setting) return;
        const expected = normalizeResponseInterceptionSetting(next || { enabled, rules });
        const validationError = validateResponseInterceptionSetting(expected);
        if (validationError) {
            message.error(validationError);
            return;
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminResponseInterceptionSetting(expected);
            if (!isResponseInterceptionSetting(result.setting)) throw new Error("服务端返回的模型响应拦截配置格式无效");
            const normalizedResult = normalizeResponseInterceptionSetting(result.setting);
            if (!responseInterceptionSettingsEqual(normalizedResult, expected)) throw new Error("服务端返回的模型响应拦截配置与本次保存内容不一致，请重新读取后核对");
            setSetting(normalizedResult);
            setEnabled(normalizedResult.enabled);
            setRules(normalizedResult.rules.map((rule) => ({ ...rule })));
            message.success("模型响应拦截配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存模型响应拦截配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const submitSave = async () => {
        if (!setting) return;
        const expected = normalizeResponseInterceptionSetting({ enabled, rules });
        const validationError = validateResponseInterceptionSetting(expected);
        if (validationError) {
            message.error(validationError);
            return;
        }
        try {
            await save(expected);
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const changeEnabled = (nextEnabled: boolean) => {
        if (!setting || saving || nextEnabled === enabled) return;
        setEnabled(nextEnabled);
        setSaveError("");
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title="模型响应拦截" description="先决定是否替换用户错误，再配置规则与优先级" scroll>
                <div className="admin-settings-stack admin-intercept-settings" aria-label="正在读取模型响应拦截配置" role="status">
                    <div className="admin-intercept-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
                    </div>
                    <div className="admin-intercept-loading-card">
                        <Skeleton active paragraph={{ rows: 7 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title="模型响应拦截" description="先决定是否替换用户错误，再配置规则与优先级" scroll>
                <div className="admin-settings-stack admin-intercept-settings">
                    <div className="admin-intercept-load-error" role="alert">
                        <span className="admin-intercept-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取模型响应拦截配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    return (
        <AdminPageFrame title="模型响应拦截" description="先决定是否替换用户错误，再配置规则与优先级" scroll>
            <div className="admin-settings-stack admin-intercept-settings">
                <div className={cn("admin-intercept-command-bar", dirty && "is-dirty")}>
                    <div className="admin-intercept-command-copy" aria-live="polite">
                        <span className="admin-intercept-command-icon">
                            <ShieldAlert className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{dirty ? "响应拦截有调整待保存" : "响应拦截配置已同步"}</strong>
                                <AdminStatusBadge label={dirty ? "尚未生效" : "服务端当前值"} tone={dirty ? "warning" : "neutral"} />
                            </div>
                            <p>{dirty ? "当前开关、文案和优先级只在本页暂存；本地预览不会调用后端。" : "仅投影用户最终看到的错误文案，原始响应与请求明细保持不变。"}</p>
                        </div>
                    </div>
                    <div className="admin-intercept-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                撤销调整
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            刷新状态
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-intercept-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <div id="admin-intercept-policy" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-intercept-section admin-intercept-policy-section"
                        icon={<ShieldAlert className="size-4" aria-hidden="true" />}
                        title="1. 是否替换用户可见的上游错误"
                        description="这是响应拦截的主开关。关闭时规则继续保留，但不会改写用户最终看到的错误文案。"
                        status={<AdminStatusBadge label={enabledDirty ? (enabled ? "待启用" : "待停用") : enabled ? "已启用" : "已停用"} tone={enabledDirty ? "warning" : enabled ? "success" : "neutral"} />}
                        footer={
                            !enabled ? (
                                <>
                                    <div className="admin-intercept-footer-note">
                                        <ShieldCheck className="size-4" aria-hidden="true" />
                                        <span>关闭后规则仍保存在服务端，需要时可重新启用</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {dirty ? (
                                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                                撤销
                                            </Button>
                                        ) : null}
                                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                            保存修改
                                        </Button>
                                    </div>
                                </>
                            ) : undefined
                        }
                    >
                        <div className="admin-intercept-policy-control">
                            <span className="admin-intercept-policy-icon">
                                <Eye className="size-4" aria-hidden="true" />
                            </span>
                            <div className="admin-intercept-policy-copy">
                                <strong>投影替换用户可见错误</strong>
                                <p>启用后按规则顺序检查错误文案，忽略英文大小写；第一条包含匹配命中后，用“替换为”整条覆盖用户所见文案。</p>
                                <span>{enabled ? (draft.rules.length ? "当前草稿会依次检查所有规则，未命中时原样显示。" : "当前没有规则，即使启用也不会改变用户所见错误。") : "当前停用，所有用户可见错误均原样显示。"}</span>
                            </div>
                            <div className="admin-intercept-policy-switch">
                                <span>{enabled ? "启用" : "停用"}</span>
                                <Switch checked={enabled} disabled={loading || refreshing || saving} aria-label="启用响应拦截规则" onChange={changeEnabled} />
                            </div>
                        </div>
                        <div className="admin-intercept-context-note">
                            <ShieldCheck className="size-4" aria-hidden="true" />
                            <span>该能力只改变任务失败和代理请求最终返回给用户的可见文案，不修改上游响应体、内部错误、失败记录或请求明细；宽泛关键词可能掩盖更具体的规则，应放在列表后方。</span>
                        </div>
                    </SettingsSectionCard>
                </div>

                {enabled ? (
                    <>
                        <div id="admin-intercept-rules" className="admin-settings-anchor">
                            <SettingsSectionCard
                                className="admin-intercept-section admin-intercept-rules-section"
                                icon={<ListOrdered className="size-4" aria-hidden="true" />}
                                title="2. 配置替换规则与优先级"
                                description="越靠前的规则越先匹配；命中后停止继续检查。匹配文案最多 200 字，替换文案最多 500 字。"
                                status={<AdminStatusBadge label={`${draft.rules.length}/${MAX_RULES} 条`} tone={duplicateRuleIndexes.size ? "warning" : draft.rules.length ? "info" : "neutral"} />}
                                footer={
                                    <>
                                        <div className="admin-intercept-footer-note">
                                            <BadgeCheck className="size-4" aria-hidden="true" />
                                            <span>保存不会调用模型或制造测试错误 · 原始上游内容继续保留</span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {dirty ? (
                                                <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                                    撤销
                                                </Button>
                                            ) : null}
                                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                                保存修改
                                            </Button>
                                        </div>
                                    </>
                                }
                            >
                                <div className="admin-intercept-rule-toolbar">
                                    <div>
                                        <strong>按优先级从上到下排列</strong>
                                        <p>重复或包含关系过宽的文案可能使后续规则无法命中，可通过箭头调整顺序并在下方本地预览。</p>
                                    </div>
                                    <Button icon={<Plus className="size-4" />} disabled={loading || refreshing || saving || rules.length >= MAX_RULES} onClick={addRule}>
                                        添加规则
                                    </Button>
                                </div>

                                {duplicateRuleIndexes.size ? (
                                    <div className="admin-intercept-duplicate-alert" role="alert">
                                        <AlertTriangle className="size-4" aria-hidden="true" />
                                        <span>存在忽略大小写后完全相同的匹配文案；相同文案只会命中最靠前的一条，请核对优先级或删除重复规则。</span>
                                    </div>
                                ) : null}

                                {rules.length ? (
                                    <div className="admin-intercept-rule-table" aria-label="模型响应拦截规则">
                                        <div className="admin-intercept-rule-header" aria-hidden="true">
                                            <span>优先级</span>
                                            <span>上游文案包含</span>
                                            <span>整条替换为</span>
                                            <span>操作</span>
                                        </div>
                                        <div className="admin-intercept-rule-list">
                                            {rules.map((rule, index) => (
                                                <div key={index} className={cn("admin-intercept-rule-row", duplicateRuleIndexes.has(index) && "has-duplicate")}>
                                                    <div className="admin-intercept-rule-index">
                                                        <span>{index + 1}</span>
                                                        <small>{index === 0 ? "最先" : `第 ${index + 1}`}</small>
                                                    </div>
                                                    <div className="admin-intercept-rule-field">
                                                        <Input
                                                            value={rule.contains}
                                                            maxLength={MAX_MATCH_RUNES}
                                                            showCount
                                                            disabled={loading || refreshing || saving}
                                                            aria-label={`第 ${index + 1} 条匹配文案`}
                                                            placeholder="例如：余额不足、HTTP 429"
                                                            onChange={(event) => updateRule(index, "contains", event.target.value)}
                                                        />
                                                        <small>忽略英文大小写，使用包含判断。</small>
                                                    </div>
                                                    <div className="admin-intercept-rule-field">
                                                        <Input.TextArea
                                                            value={rule.replace}
                                                            maxLength={MAX_REPLACE_RUNES}
                                                            showCount
                                                            autoSize={{ minRows: 1, maxRows: 4 }}
                                                            disabled={loading || refreshing || saving}
                                                            aria-label={`第 ${index + 1} 条替换文案`}
                                                            placeholder="例如：服务暂时繁忙，请稍后重试"
                                                            onChange={(event) => updateRule(index, "replace", event.target.value)}
                                                        />
                                                        <small>命中后整条替换，不是局部替换。</small>
                                                    </div>
                                                    <div className="admin-intercept-rule-actions">
                                                        <Button type="text" icon={<ArrowUp className="size-4" />} aria-label={`上移第 ${index + 1} 条规则`} disabled={loading || refreshing || saving || index === 0} onClick={() => moveRule(index, -1)} />
                                                        <Button
                                                            type="text"
                                                            icon={<ArrowDown className="size-4" />}
                                                            aria-label={`下移第 ${index + 1} 条规则`}
                                                            disabled={loading || refreshing || saving || index === rules.length - 1}
                                                            onClick={() => moveRule(index, 1)}
                                                        />
                                                        <Button type="text" danger icon={<Trash2 className="size-4" />} aria-label={`删除第 ${index + 1} 条规则`} disabled={loading || refreshing || saving} onClick={() => removeRule(index)} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="admin-intercept-empty">
                                        <span>
                                            <Search className="size-5" aria-hidden="true" />
                                        </span>
                                        <div>
                                            <strong>还没有拦截规则</strong>
                                            <p>用户可见错误会保持原样。添加规则后可先在本地预览，再决定是否保存和启用。</p>
                                        </div>
                                        <Button icon={<Plus className="size-4" />} disabled={loading || refreshing || saving} onClick={addRule}>
                                            添加第一条规则
                                        </Button>
                                    </div>
                                )}
                            </SettingsSectionCard>
                        </div>

                        <div id="admin-intercept-preview" className="admin-settings-anchor">
                            <SettingsSectionCard
                                className="admin-intercept-section admin-intercept-preview-section"
                                icon={<Eye className="size-4" aria-hidden="true" />}
                                title="3. 本地预览用户最终文案"
                                description="使用当前草稿模拟服务端的裁剪、忽略大小写包含和首条命中逻辑；内容不会发送或保存。"
                                status={<AdminStatusBadge label="仅当前浏览器" tone="neutral" />}
                            >
                                <div className="admin-intercept-preview-grid">
                                    <div className="admin-intercept-preview-input">
                                        <label htmlFor="admin-intercept-preview-input">模拟上游错误文案</label>
                                        <Input.TextArea id="admin-intercept-preview-input" value={previewInput} autoSize={{ minRows: 4, maxRows: 8 }} placeholder="粘贴一段用于本地预览的错误文案" onChange={(event) => setPreviewInput(event.target.value)} />
                                        <p>只在内存中计算，不进入保存请求、审计或请求明细。</p>
                                    </div>
                                    <div className="admin-intercept-preview-result" aria-live="polite">
                                        <div className="admin-intercept-preview-heading">
                                            <strong>用户最终可见文案</strong>
                                            <AdminStatusBadge
                                                label={!preview.raw ? "等待输入" : preview.matchIndex < 0 ? "未命中" : enabled ? `命中第 ${preview.matchIndex + 1} 条` : `可命中第 ${preview.matchIndex + 1} 条但全局停用`}
                                                tone={!preview.raw || preview.matchIndex < 0 || !enabled ? "neutral" : "success"}
                                            />
                                        </div>
                                        <p className={cn(!preview.output && "is-placeholder")}>{preview.output || "输入模拟错误后，这里会显示按当前开关和规则计算的结果。"}</p>
                                        <small>
                                            {preview.matchIndex >= 0
                                                ? enabled
                                                    ? "已按首条命中规则整条替换。"
                                                    : "规则可以命中，但全局开关停用，所以实际仍原样显示。"
                                                : preview.raw
                                                  ? "没有规则包含该文案，因此保持原样。"
                                                  : "预览不验证真实上游响应，也不会触发模型请求。"}
                                        </small>
                                    </div>
                                </div>
                            </SettingsSectionCard>
                        </div>
                    </>
                ) : null}
            </div>
        </AdminPageFrame>
    );
}

function normalizeResponseInterceptionSetting(value: ResponseInterceptionSetting): ResponseInterceptionSetting {
    return {
        enabled: Boolean(value.enabled),
        rules: Array.isArray(value.rules) ? value.rules.map((rule) => ({ contains: rule.contains.trim(), replace: rule.replace.trim() })) : [],
    };
}

function validateResponseInterceptionSetting(value: ResponseInterceptionSetting) {
    if (value.rules.length > MAX_RULES) return `模型响应拦截规则不能超过 ${MAX_RULES} 条`;
    for (let index = 0; index < value.rules.length; index += 1) {
        const rule = value.rules[index];
        if (!rule.contains) return `第 ${index + 1} 条拦截规则的匹配文案不能为空`;
        if (Array.from(rule.contains).length > MAX_MATCH_RUNES) return `第 ${index + 1} 条拦截规则的匹配文案不能超过 ${MAX_MATCH_RUNES} 个字符`;
        if (!rule.replace) return `第 ${index + 1} 条拦截规则的替换文案不能为空`;
        if (Array.from(rule.replace).length > MAX_REPLACE_RUNES) return `第 ${index + 1} 条拦截规则的替换文案不能超过 ${MAX_REPLACE_RUNES} 个字符`;
    }
    return "";
}

function responseInterceptionSettingsEqual(left: ResponseInterceptionSetting, right: ResponseInterceptionSetting) {
    const normalizedLeft = normalizeResponseInterceptionSetting(left);
    const normalizedRight = normalizeResponseInterceptionSetting(right);
    if (normalizedLeft.enabled !== normalizedRight.enabled || normalizedLeft.rules.length !== normalizedRight.rules.length) return false;
    return normalizedLeft.rules.every((rule, index) => rule.contains === normalizedRight.rules[index].contains && rule.replace === normalizedRight.rules[index].replace);
}

function findDuplicateRuleIndexes(rules: ResponseInterceptionRule[]) {
    const seen = new Map<string, number>();
    const duplicates = new Set<number>();
    rules.forEach((rule, index) => {
        const key = rule.contains.trim().toLocaleLowerCase();
        if (!key) return;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, index);
        else {
            duplicates.add(first);
            duplicates.add(index);
        }
    });
    return duplicates;
}

function previewResponseInterception(input: string, setting: ResponseInterceptionSetting) {
    const raw = input.trim();
    if (!raw) return { raw: "", output: "", matchIndex: -1 };
    const lower = raw.toLocaleLowerCase();
    const matchIndex = setting.rules.findIndex((rule) => rule.contains && lower.includes(rule.contains.toLocaleLowerCase()));
    return {
        raw,
        matchIndex,
        output: setting.enabled && matchIndex >= 0 ? setting.rules[matchIndex].replace : raw,
    };
}

function isResponseInterceptionSetting(value: unknown): value is ResponseInterceptionSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<ResponseInterceptionSetting>;
    return typeof setting.enabled === "boolean" && Array.isArray(setting.rules) && setting.rules.every((rule) => Boolean(rule && typeof rule === "object" && typeof rule.contains === "string" && typeof rule.replace === "string"));
}
