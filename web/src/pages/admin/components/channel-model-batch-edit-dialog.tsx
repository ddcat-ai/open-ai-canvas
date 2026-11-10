import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, App, Checkbox, Input } from "antd";
import { Select } from "@/components/ui/base/select";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { getActiveUserScope } from "@/lib/user-scope";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { updateAdminAllChannelModels, updateAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import { useUserStore } from "@/stores/use-user-store";
import { assertBatchModelSelectionCurrent, batchChannelModelUpdates, batchDraftRequiresProtocol, batchModelGroups, type BatchModelGroupDraft, type BatchModelGroupKey, type ChannelModelBatchDraft } from "./channel-model-batch-edit";
import { ChannelModelBatchConfig, type BatchGroupSelection } from "./channel-model-batch-config";
import { CAPABILITY_TEMPLATES_CHANGED, capabilityTemplatesKey, readCapabilityTemplates } from "./saved-capability-templates";
import { PRICING_TEMPLATES_CHANGED, pricingTemplatesKey, readPricingTemplates } from "./saved-pricing-templates";
import { ModelDisplayNameInput } from "./model-display-name-input";

type Field = "displayName" | "description" | "enabled" | "pricingEnabled";
type Props = {
    channelId?: string;
    items: ChannelModel[];
    currentItems: ChannelModel[];
    contextKey: string;
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
};

function loadTemplates<T>(read: () => T[]) {
    try {
        return { items: read(), error: "" };
    } catch (error) {
        return { items: [] as T[], error: error instanceof Error ? error.message : "无法读取模板" };
    }
}

export function ChannelModelBatchEditDialog({ channelId, items, currentItems, contextKey, protocols, protocolLoading, protocolError, onClose, onSaved }: Props) {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const [scope] = useState(getActiveUserScope);
    const [openedContext] = useState(contextKey);
    const [capabilityLibrary] = useState(() => loadTemplates(() => readCapabilityTemplates(scope)));
    const [pricingLibrary] = useState(() => loadTemplates(() => readPricingTemplates(scope)));
    const [, refreshTemplates] = useState(0);
    const [selected, setSelected] = useState<Partial<Record<Field, boolean>>>({});
    const [groupSelections, setGroupSelections] = useState<Partial<Record<BatchModelGroupKey, BatchGroupSelection>>>({});
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [enabled, setEnabled] = useState(true);
    const [pricingEnabled, setPricingEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const saveLock = useRef(false);
    const latestCallbacks = useRef({ onClose, onSaved });
    latestCallbacks.current = { onClose, onSaved };
    const hasChanges = Object.values(selected).some(Boolean) || Object.values(groupSelections).some((group) => group && Object.values(group).some((value) => value !== undefined));

    useEffect(() => {
        const changed = (event: Event) => {
            if ((event as CustomEvent).detail === scope) refreshTemplates((value) => value + 1);
        };
        const storage = (event: StorageEvent) => {
            if (!event.key || event.key === capabilityTemplatesKey(scope) || event.key === pricingTemplatesKey(scope) || event.key === "yingce:active-user-scope") refreshTemplates((value) => value + 1);
        };
        window.addEventListener(CAPABILITY_TEMPLATES_CHANGED, changed);
        window.addEventListener(PRICING_TEMPLATES_CHANGED, changed);
        window.addEventListener("storage", storage);
        return () => {
            window.removeEventListener(CAPABILITY_TEMPLATES_CHANGED, changed);
            window.removeEventListener(PRICING_TEMPLATES_CHANGED, changed);
            window.removeEventListener("storage", storage);
        };
    }, [scope]);

    const prepare = () => {
        if (scope === "guest" || userId !== scope || useUserStore.getState().user?.id !== scope || getActiveUserScope() !== scope) throw new Error("账号已切换，请关闭后重新打开批量修改");
        if (contextKey !== openedContext) throw new Error("当前 Key 或筛选已变化，请关闭后重新打开批量修改");
        assertBatchModelSelectionCurrent(items, currentItems);
        if (channelId && items.some((item) => item.channelId !== channelId)) throw new Error("当前 Key 已变化，请重新选择模型");
        const draft: ChannelModelBatchDraft = { groups: {} };
        for (const group of batchModelGroups(items)) {
            const selection = groupSelections[group.key];
            if (!selection) continue;
            const changes: BatchModelGroupDraft = { capability: selection.capability, protocol: selection.protocol };
            draft.groups![group.key] = changes;
            if (selection.capabilityId) {
                if (selection.capabilityId.startsWith("builtin:")) changes.capabilityTemplate = { builtin: selection.capabilityId.slice(8) };
                else {
                    const saved = capabilityLibrary.items.find((item) => `saved:${item.id}` === selection.capabilityId);
                    const latest = readCapabilityTemplates(scope).find((item) => item.id === saved?.id);
                    if (!saved || !latest || JSON.stringify(saved) !== JSON.stringify(latest)) throw new Error("能力模板已变更，请关闭后重新打开批量修改");
                    changes.capabilityTemplate = { saved };
                }
            }
            if (selection.pricingId) {
                const saved = pricingLibrary.items.find((item) => item.id === selection.pricingId);
                const latest = readPricingTemplates(scope).find((item) => item.id === saved?.id);
                if (!saved || !latest || JSON.stringify(saved) !== JSON.stringify(latest)) throw new Error("积分模板已变更，请关闭后重新打开批量修改");
                changes.pricingTemplate = saved;
            }
        }
        if (selected.displayName) draft.displayName = displayName;
        if (selected.description) draft.description = description;
        if (selected.enabled) draft.enabled = enabled;
        if (selected.pricingEnabled) draft.pricingEnabled = pricingEnabled;
        if (batchDraftRequiresProtocol(draft)) {
            if (protocolLoading) throw new Error("正在读取协议，请稍候");
            if (protocolError) throw new Error(protocolError);
        }
        return batchChannelModelUpdates(items, draft, protocols);
    };
    let validationError = "";
    if (hasChanges) {
        try {
            prepare();
        } catch (error) {
            validationError = error instanceof Error ? error.message : "请检查修改内容";
        }
    }
    const save = async () => {
        if (saveLock.current) return;
        let payload;
        try {
            payload = prepare();
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "请检查修改内容");
            return;
        }
        saveLock.current = true;
        setSaving(true);
        setSubmitError("");
        let updated = 0;
        try {
            const result = channelId ? await updateAdminChannelModels(channelId, payload) : await updateAdminAllChannelModels(payload);
            updated = result.updated;
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "批量修改失败");
            saveLock.current = false;
            setSaving(false);
            return;
        }
        // 写入成功后不再开放提交，刷新失败也不能重发这批修改。
        try {
            if (useUserStore.getState().user?.id === scope && getActiveUserScope() === scope) await latestCallbacks.current.onSaved();
            message.success(`已修改 ${updated} 个模型`);
        } catch {
            message.warning("已保存，刷新失败，请手动刷新列表");
        } finally {
            latestCallbacks.current.onClose();
        }
    };
    const row = (field: Field, label: string, content: ReactNode, disabled = false) => (
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[136px_minmax(0,1fr)]" key={field}>
            <Checkbox
                aria-label={`修改${label}`}
                checked={Boolean(selected[field])}
                disabled={saving || disabled}
                onChange={(event) => {
                    setSelected((current) => ({ ...current, [field]: event.target.checked }));
                    setSubmitError("");
                }}
            >
                {label}
            </Checkbox>
            {content}
        </div>
    );
    return (
        <AdminModal
            title={`批量修改 · ${items.length} 个模型`}
            open
            centered
            width={760}
            styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto" } }}
            onCancel={() => {
                if (!saveLock.current) onClose();
            }}
            closable={!saving}
            mask={{ closable: !saving }}
            keyboard={!saving}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            okButtonProps={{ disabled: !hasChanges || Boolean(validationError) }}
            okText="保存"
            cancelText="取消"
            onOk={() => void save()}
        >
            <div className="space-y-4">
                <ChannelModelBatchConfig
                    items={items}
                    selection={groupSelections}
                    protocols={protocols}
                    capabilityTemplates={capabilityLibrary.items}
                    pricingTemplates={pricingLibrary.items}
                    capabilityError={capabilityLibrary.error}
                    pricingError={pricingLibrary.error}
                    saving={saving}
                    protocolLoading={protocolLoading}
                    protocolError={protocolError}
                    onChange={(key, value) => {
                        setGroupSelections((current) => ({ ...current, [key]: value }));
                        setSubmitError("");
                    }}
                />
                {capabilityLibrary.error || pricingLibrary.error ? <Alert type="warning" title={capabilityLibrary.error || pricingLibrary.error} /> : null}
                {protocolError && !validationError ? <Alert type="warning" title={protocolError} /> : null}
                <p className="border-t border-foreground/10 pt-3 text-xs text-foreground/50">以下项目仅修改勾选项</p>
                {row(
                    "displayName",
                    "模型展示名",
                    <ModelDisplayNameInput
                        aria-label="批量模型展示名"
                        className="w-full"
                        placeholder={selected.displayName ? "留空归入未分类" : "不修改"}
                        disabled={saving || !selected.displayName}
                        value={displayName}
                        onChange={(value) => {
                            setDisplayName(value);
                            setSubmitError("");
                        }}
                    />,
                )}
                {row(
                    "description",
                    "备注",
                    <Input.TextArea
                        aria-label="批量备注"
                        placeholder={selected.description ? "留空清除备注" : "不修改"}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        maxLength={500}
                        disabled={saving || !selected.description}
                        value={description}
                        onChange={(event) => {
                            setDescription(event.target.value);
                            setSubmitError("");
                        }}
                    />,
                )}
                {row(
                    "enabled",
                    "模型启用",
                    <Select
                        ariaLabel="批量模型启用"
                        className="w-full"
                        disabled={saving || !selected.enabled}
                        value={selected.enabled ? String(enabled) : undefined}
                        placeholder="不修改"
                        options={[
                            { label: "启用", value: "true" },
                            { label: "停用", value: "false" },
                        ]}
                        onChange={(value) => {
                            setEnabled(value === "true");
                            setSubmitError("");
                        }}
                    />,
                )}
                {row(
                    "pricingEnabled",
                    "可供用户使用",
                    <Select
                        ariaLabel="批量可供用户使用"
                        className="w-full"
                        disabled={saving || !selected.pricingEnabled}
                        value={selected.pricingEnabled ? String(pricingEnabled) : undefined}
                        placeholder="不修改"
                        options={[
                            { label: "开启全部价格档", value: "true" },
                            { label: "关闭全部价格档", value: "false" },
                        ]}
                        onChange={(value) => {
                            setPricingEnabled(value === "true");
                            setSubmitError("");
                        }}
                    />,
                )}
                {validationError || submitError ? <Alert type="error" showIcon title={validationError || submitError} /> : null}
            </div>
        </AdminModal>
    );
}
