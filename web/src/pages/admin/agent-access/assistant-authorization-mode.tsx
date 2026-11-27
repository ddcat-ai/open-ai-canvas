import { Radio } from "antd";
import type { AssistantApprovalMode } from "@/services/api/admin-assistant";

export const assistantApprovalModeLabel = (mode: string) => (mode === "full_access" ? "全权委托" : "逐次确认");

export function AssistantAuthorizationMode({ value, onChange, disabled }: { value: AssistantApprovalMode; onChange: (mode: AssistantApprovalMode) => void; disabled?: boolean }) {
    return (
        <fieldset className="min-w-0 space-y-3">
            <legend className="mb-2 text-sm font-medium">Agent 执行方式</legend>
            <Radio.Group className="flex flex-col gap-3" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as AssistantApprovalMode)}>
                <Radio value="full_access">
                    <strong className="font-medium">全权委托</strong>
                    <span className="mt-1 block text-sm text-muted-foreground">允许 Agent 使用你账号的全部后台管理能力，包括删除、财务调整和系统配置，执行时不再逐项确认。可随时切换或撤销。</span>
                </Radio>
                <Radio value="request_approval">
                    <strong className="font-medium">逐次确认</strong>
                    <span className="mt-1 block text-sm text-muted-foreground">按已授权的模块读写，标记为高风险的操作每次执行前由你确认。</span>
                </Radio>
            </Radio.Group>
        </fieldset>
    );
}
