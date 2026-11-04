import { App, AutoComplete, Button, Form, Input, Popconfirm } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Select } from "@/components/ui/base/select";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { translate } from "@/i18n";
import { WorkflowFieldMappingEditor } from "@/components/workflow-field-mapping-editor";
import { WorkflowGraphEditor } from "@/components/workflow-graph-editor";
import { WorkflowTestWorkbench } from "@/components/workflow-test-workbench";
import { fetchRunningHubApp, fetchRunningHubWorkflow } from "@/services/api/runninghub";
import {
    normalizeRunningHubCapability,
    normalizeRunningHubWorkflowKind,
    mergeWorkflowFieldMappings,
    normalizeWorkflowFieldMappings,
    useConfigStore,
    type RunningHubCapability,
    type RunningHubConfig,
    type RunningHubWorkflow,
    type RunningHubWorkflowKind,
    type WorkflowFieldMapping,
} from "@/stores/use-config-store";

const CAPABILITIES: RunningHubCapability[] = ["image", "video", "audio"];

function workflowCapability(workflow: RunningHubWorkflow | undefined, fallback: RunningHubCapability): RunningHubCapability {
    return normalizeRunningHubCapability(workflow?.capability, normalizeRunningHubCapability(fallback));
}

function workflowKind(workflow: RunningHubWorkflow | undefined): RunningHubWorkflowKind {
    return normalizeRunningHubWorkflowKind(workflow?.kind);
}

function workflowEntryKey(workflow: RunningHubWorkflow): string {
    return `${workflowKind(workflow)}:${workflow.workflowId.trim()}`;
}

function capabilityLabel(capability: RunningHubCapability) {
    return translate(capability === "video" ? "account.settings.modelConfig.capabilities.video" : capability === "audio" ? "account.settings.modelConfig.capabilities.audio" : "account.settings.modelConfig.capabilities.image");
}

function workflowNeedsMediaUpload(fields: WorkflowFieldMapping[]) {
    return fields.some((field) => {
        const source = String(field.source || "")
            .trim()
            .toLowerCase();
        const fieldType = String(field.fieldType || "")
            .trim()
            .toUpperCase();
        return ["referenceimage", "referencevideo", "referenceaudio", "mask"].includes(source) || ["IMAGE", "VIDEO", "AUDIO"].includes(fieldType);
    });
}

export function RunningHubSettingsPane() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const capabilityOptions = useMemo(() => CAPABILITIES.map((value) => ({ label: capabilityLabel(value), value })), []);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const runningHub = config.runningHub;
    const selected = runningHub.workflows.find((item) => item.workflowId.trim() === runningHub.workflowId.trim() && workflowKind(item) === runningHub.selectedKind);
    const selectedKey = selected ? workflowEntryKey(selected) : undefined;
    const [draftId, setDraftId] = useState(selected?.workflowId || "");
    const [workflowText, setWorkflowText] = useState(selected?.workflowJson ? JSON.stringify(selected.workflowJson, null, 2) : "");
    const [kind, setKind] = useState<RunningHubWorkflowKind>(selected ? workflowKind(selected) : runningHub.selectedKind);
    const [title, setTitle] = useState(selected?.title || "");
    const [capability, setCapability] = useState<RunningHubCapability>(workflowCapability(selected, runningHub.capability));
    const [fetching, setFetching] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<"fields" | "test">("fields");

    useEffect(() => {
        if (!selected) return;
        setDraftId(selected.workflowId);
        setWorkflowText(selected.workflowJson ? JSON.stringify(selected.workflowJson, null, 2) : "");
        setKind(workflowKind(selected));
        setTitle(selected.title || "");
        setCapability(workflowCapability(selected, runningHub.capability));
    }, [selectedKey, selected?.workflowJson, selected?.title, selected?.capability, runningHub.capability]);

    const update = (patch: Partial<RunningHubConfig>) => updateConfig("runningHub", { ...runningHub, ...patch });
    const draftMatchesSelected = Boolean(selected && workflowEntryKey(selected) === `${kind}:${draftId.trim()}`);

    const persistWorkflow = (workflow: RunningHubWorkflow, nextCapability = capability) => {
        const workflowId = workflow.workflowId.trim();
        if (!workflowId) return;
        const nextKind = workflowKind(workflow);
        const next: RunningHubWorkflow = {
            ...workflow,
            kind: nextKind,
            workflowId,
            capability: normalizeRunningHubCapability(nextCapability, capability),
            fields: normalizeWorkflowFieldMappings(workflow.fields, normalizeRunningHubCapability(nextCapability, capability)),
        };
        if (nextKind === "app") {
            // AI 应用只保存其公开参数，绝不能继续携带之前 Workflow 的 JSON。
            delete next.workflowJson;
            next.webappId = (next.webappId || workflowId).trim();
        } else {
            delete next.webappId;
        }
        const nextKey = workflowEntryKey(next);
        update({
            workflowId,
            selectedKind: nextKind,
            capability: next.capability || capability,
            workflows: [...runningHub.workflows.filter((item) => workflowEntryKey(item) !== nextKey), next],
        });
    };

    const fetchWorkflow = async () => {
        const id = draftId.trim();
        if (!id) return message.warning(kind === "app" ? t("account.settings.runninghub.webappIdRequired") : t("account.settings.runninghub.workflowIdRequired"));
        if (!runningHub.apiKey.trim()) return message.warning(t("account.settings.runninghub.apiKeyRequired"));
        setFetching(true);
        try {
            // 管理接口只接受拉取参数所需的小请求，不能把已保存工作流及大段 JSON 一并提交。
            const fetchConfig = {
                baseUrl: runningHub.baseUrl,
                apiKey: runningHub.apiKey,
                walletApiKey: "",
                useWallet: false,
                title: title.trim(),
                capability,
            };
            const result = kind === "app" ? await fetchRunningHubApp({ ...fetchConfig, webappId: id }) : await fetchRunningHubWorkflow({ ...fetchConfig, workflowId: id });
            const existing = runningHub.workflows.find((workflow) => workflowEntryKey(workflow) === `${kind}:${id}`);
            const item: RunningHubWorkflow = {
                ...result,
                kind,
                workflowId: id,
                webappId: kind === "app" ? result.webappId || id : undefined,
                title: result.title || title.trim() || id,
                fields: existing ? mergeWorkflowFieldMappings(existing.fields, result.fields, capability) : normalizeWorkflowFieldMappings(result.fields, capability),
                workflowJson: kind === "workflow" ? result.workflowJson || {} : undefined,
            };
            persistWorkflow(item, capability);
            setWorkflowText(item.workflowJson ? JSON.stringify(item.workflowJson, null, 2) : "");
            setTitle(item.title || "");
            message.success(
                workflowNeedsMediaUpload(item.fields || [])
                    ? kind === "app"
                        ? t("account.settings.runninghub.appSavedUpload")
                        : t("account.settings.runninghub.workflowSavedUpload")
                    : kind === "app"
                      ? t("account.settings.runninghub.appSaved")
                      : t("account.settings.runninghub.workflowSaved"),
            );
        } catch (error) {
            message.error(error instanceof Error ? t("account.settings.runninghub.fetchFailedWith", { error: error.message }) : t("account.settings.runninghub.fetchFailed"));
        } finally {
            setFetching(false);
        }
    };

    const removeWorkflow = (workflow: RunningHubWorkflow) => {
        const targetKey = workflowEntryKey(workflow);
        const remaining = runningHub.workflows.filter((item) => workflowEntryKey(item) !== targetKey);
        update({ workflowId: "", selectedKind: workflowKind(workflow), workflows: remaining });
        setDraftId("");
        setWorkflowText("");
        setTitle("");
        message.success(t(workflowKind(workflow) === "app" ? "account.settings.runninghub.deletedApp" : "account.settings.runninghub.deletedWorkflow", { name: workflow.title || workflow.workflowId }));
    };

    const updateCapability = (value: RunningHubCapability) => {
        const nextCapability = normalizeRunningHubCapability(value, capability);
        setCapability(nextCapability);
        if (selected && draftMatchesSelected) persistWorkflow({ ...selected, capability: nextCapability }, nextCapability);
    };

    const selectWorkflow = (entryKey: string | undefined) => {
        if (!entryKey) {
            update({ workflowId: "" });
            setDraftId("");
            setWorkflowText("");
            setTitle("");
            return;
        }
        const workflow = runningHub.workflows.find((item) => workflowEntryKey(item) === entryKey);
        if (!workflow) return message.error(t("account.settings.runninghub.entryMissing"));
        const nextCapability = workflowCapability(workflow, runningHub.capability);
        update({ workflowId: workflow.workflowId.trim(), selectedKind: workflowKind(workflow), capability: nextCapability });
        setDraftId(workflow.workflowId.trim());
        setWorkflowText(workflow.workflowJson ? JSON.stringify(workflow.workflowJson, null, 2) : "");
        setKind(workflowKind(workflow));
        setTitle(workflow.title || "");
        setCapability(nextCapability);
    };

    const changeKind = (nextKind: RunningHubWorkflowKind) => {
        setKind(nextKind);
        setDraftId("");
        setWorkflowText("");
        setTitle("");
        update({ workflowId: "", selectedKind: nextKind });
    };

    const updateWorkflowJson = (value: string) => {
        if (kind === "app") return;
        if (!selected || !draftMatchesSelected) return message.warning(t("account.settings.runninghub.selectFirst"));
        try {
            const parsed = value.trim() ? JSON.parse(value) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("account.settings.runninghub.jsonObject"));
            persistWorkflow({ ...selected, title: title.trim() || selected.title, workflowJson: parsed });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.settings.runninghub.jsonInvalid"));
        }
    };

    const updateWorkflowFields = (fields: WorkflowFieldMapping[]) => {
        if (!selected || !draftMatchesSelected) return;
        persistWorkflow({ ...selected, title: title.trim() || selected.title, fields });
    };

    const updateTitle = () => {
        if (!selected || !draftMatchesSelected) return;
        persistWorkflow({ ...selected, title: title.trim() || selected.workflowId });
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{t("settings.sections.runninghub.label")}</h2>
                    <p>{t("account.settings.runninghub.description")}</p>
                </div>
                <Switch checked={runningHub.enabled} checkedChildren={t("account.layout.oss.switchOn")} unCheckedChildren={t("account.layout.oss.switchOff")} onChange={(enabled) => update({ enabled })} />
            </div>
            <div className="settings-section grid gap-3 lg:grid-cols-12">
                <Form.Item label="Base URL" className="mb-0 lg:col-span-6">
                    <AutoComplete
                        className="w-full"
                        value={runningHub.baseUrl}
                        options={[
                            { label: t("account.settings.runninghub.siteCn", { url: "https://www.runninghub.cn" }), value: "https://www.runninghub.cn" },
                            { label: t("account.settings.runninghub.siteGlobal", { url: "https://www.runninghub.ai" }), value: "https://www.runninghub.ai" },
                        ]}
                        onChange={(baseUrl) => update({ baseUrl })}
                        onBlur={() => update({ baseUrl: runningHub.baseUrl.trim().replace(/\/+$/, "") })}
                    >
                        <Input placeholder={t("account.settings.runninghub.baseUrlPlaceholder")} />
                    </AutoComplete>
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.apiKey")} className="mb-0 lg:col-span-6" extra={t("account.settings.runninghub.apiKeyHint")}>
                    <Input.Password autoComplete="new-password" value={runningHub.apiKey} onChange={(event) => update({ apiKey: event.target.value })} />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.uploadKey")} className="mb-0 lg:col-span-6" extra={t("account.settings.runninghub.uploadKeyHint")}>
                    <Input.Password autoComplete="new-password" value={runningHub.uploadApiKey || ""} onChange={(event) => update({ uploadApiKey: event.target.value })} />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.capability")} className="mb-0 lg:col-span-6">
                    <Select className="w-full" value={capability} options={capabilityOptions} onChange={(value) => updateCapability(value as RunningHubCapability)} />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.saved")} className="mb-0 lg:col-span-6">
                    <Select
                        className="w-full"
                        allowClear
                        value={selectedKey}
                        options={runningHub.workflows.map((item) => ({
                            label: `${workflowKind(item) === "app" ? "App" : "Workflow"} · ${item.title || item.workflowId} · ${capabilityLabel(workflowCapability(item, runningHub.capability))}`,
                            value: workflowEntryKey(item),
                        }))}
                        placeholder={t("account.settings.runninghub.savedPlaceholder")}
                        onChange={selectWorkflow}
                    />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.kind")} className="mb-0 lg:col-span-3">
                    <SegmentedControl
                        block
                        value={kind}
                        options={[
                            { label: "Workflow", value: "workflow" },
                            { label: "App", value: "app" },
                        ]}
                        onChange={(value) => changeKind(value as RunningHubWorkflowKind)}
                    />
                </Form.Item>
                <Form.Item label={kind === "app" ? "webappId" : "workflowId"} className="mb-0 lg:col-span-3">
                    <Input value={draftId} placeholder={kind === "app" ? "RunningHub webappId" : "RunningHub workflowId"} onChange={(event) => setDraftId(event.target.value)} />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.title")} className="mb-0 lg:col-span-6">
                    <Input value={title} placeholder={t("account.settings.diagnostics.optional")} onChange={(event) => setTitle(event.target.value)} onBlur={updateTitle} />
                </Form.Item>
                <Form.Item label={t("account.settings.runninghub.actions")} className="workflow-entry-actions-field mb-0 lg:col-span-6">
                    <div className="workflow-entry-actions">
                        <Button type="primary" icon={<RefreshCw className="size-4" />} loading={fetching} onClick={() => void fetchWorkflow()}>
                            {t("account.settings.runninghub.fetch")}
                        </Button>
                        <Popconfirm
                            title={t("account.settings.runninghub.deleteTitle")}
                            description={selected ? `${workflowKind(selected) === "app" ? "App" : "Workflow"} · ${selected.title || selected.workflowId}` : undefined}
                            okText={t("common.delete")}
                            cancelText={t("common.cancel")}
                            onConfirm={() => selected && removeWorkflow(selected)}
                        >
                            <Button danger icon={<Trash2 className="size-4" />} disabled={!selected}>
                                {t("common.delete")}
                            </Button>
                        </Popconfirm>
                    </div>
                </Form.Item>
                <div className="workflow-workspace-tabs lg:col-span-12">
                    <SegmentedControl
                        block
                        value={workspaceMode}
                        options={[
                            { label: t("account.settings.runninghub.tabFields"), value: "fields" },
                            { label: t("account.settings.runninghub.tabTest"), value: "test" },
                        ]}
                        onChange={(value) => setWorkspaceMode(value as "fields" | "test")}
                    />
                </div>
                {workspaceMode === "fields" && kind === "workflow" ? (
                    <>
                        <div className="lg:col-span-12">
                            <WorkflowGraphEditor
                                workflowJson={selected?.workflowJson}
                                fields={selected?.fields || []}
                                disabled={!selected || !draftMatchesSelected}
                                onChange={updateWorkflowFields}
                                emptyDescription={t("account.settings.runninghub.graphEmpty")}
                            />
                        </div>
                        <details className="workflow-json-details lg:col-span-12">
                            <summary>{t("account.settings.runninghub.jsonSummary")}</summary>
                            <Form.Item className="mb-0 mt-3" extra={t("account.settings.runninghub.jsonHint")}>
                                <Input.TextArea
                                    rows={12}
                                    value={workflowText}
                                    spellCheck={false}
                                    placeholder={'{"3":{"class_type":"...","inputs":{}}}'}
                                    onChange={(event) => setWorkflowText(event.target.value)}
                                    onBlur={() => updateWorkflowJson(workflowText)}
                                />
                            </Form.Item>
                        </details>
                    </>
                ) : null}
                {workspaceMode === "fields" && kind === "app" ? (
                    <Form.Item label={t("account.settings.runninghub.appMapping")} className="mb-0 lg:col-span-12" extra={t("account.settings.runninghub.appMappingHint")}>
                        <WorkflowFieldMappingEditor fields={selected?.fields || []} disabled={!selected || !draftMatchesSelected} onChange={updateWorkflowFields} />
                    </Form.Item>
                ) : null}
                {workspaceMode === "test" ? (
                    <div className="lg:col-span-12">
                        <WorkflowTestWorkbench
                            key={`runninghub:${selectedKey || "empty"}`}
                            provider="runninghub"
                            workflowId={selected?.workflowId || ""}
                            workflowKind={selected ? workflowKind(selected) : kind}
                            title={selected?.title || title || draftId}
                            capability={selected ? workflowCapability(selected, capability) : capability}
                            fields={selected?.fields || []}
                            disabled={!selected || !draftMatchesSelected || !runningHub.baseUrl.trim() || !runningHub.apiKey.trim()}
                            disabledReason={
                                !selected || !draftMatchesSelected ? t("account.settings.runninghub.testNeedEntry") : !runningHub.baseUrl.trim() ? t("account.settings.runninghub.testNeedBaseUrl") : t("account.settings.runninghub.apiKeyRequired")
                            }
                        />
                    </div>
                ) : null}
            </div>
        </Form>
    );
}

export function runningHubWorkflow(config: RunningHubConfig): RunningHubWorkflow | undefined {
    const workflowId = config.workflowId.trim();
    return config.workflows.find((item) => item.workflowId.trim() === workflowId && workflowKind(item) === config.selectedKind);
}
