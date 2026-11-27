const operationLabels: Record<string, string> = {
    AdminAdjustCredits: "调整用户积分",
    UpdateUser: "修改用户信息",
    DeleteUser: "删除用户",
    BulkDisableUsers: "批量停用用户",
    CreateAdminUser: "创建用户",
    CreateSystemChannel: "创建模型渠道",
    UpdateSystemChannel: "修改模型渠道",
    DeleteSystemChannel: "删除模型渠道",
    SaveAdminChannelModel: "保存渠道模型",
    BatchUpdateAdminAllChannelModels: "批量修改渠道模型",
    SaveModelPricing: "保存模型定价",
    ResolveBillingOrder: "处理账单订单",
    ResolveBillingOrders: "批量处理账单订单",
    UpdatePaymentSettings: "修改支付设置",
    UpdatePaymentProviderConfig: "修改支付服务配置",
    UpdateRuntimePolicySetting: "修改运行策略",
    UpdateAgentSessionLimit: "修改 Agent 并发上限",
    UpdateAppearance: "修改界面外观",
    TestMCPConnection: "检测 MCP 连接",
    SaveMCPConnection: "保存 MCP 连接",
    DeleteMCPConnection: "删除 MCP 连接",
    CreateOfficialAsset: "创建官方素材",
    UpdateOfficialAsset: "修改官方素材",
    DeleteOfficialAsset: "删除官方素材",
    PublishOfficialAsset: "发布官方素材",
    ImportOfficialAssetResourceURL: "导入远程素材文件",
    AdminStartUpdate: "启动系统更新",
    AdminRollbackUpdate: "回滚系统版本",
};

const statusLabels: Record<string, string> = {
    pending: "等待确认",
    ready: "待执行",
    approved: "已批准，等待 Agent 执行",
    rejected: "已拒绝",
    running: "执行中",
    unknown: "结果待核实",
    succeeded: "已完成",
    failed: "执行失败",
    expired: "已过期",
    canceled: "已取消",
};

export const assistantCallTitle = (operation: string) => operationLabels[operation] ?? "后台管理操作";
export const assistantCallStatus = (status: string) => statusLabels[status] ?? "状态待核实";

const fieldLabels: Record<string, string> = {
    id: "对象 ID",
    userId: "用户 ID",
    userID: "用户 ID",
    username: "用户名",
    name: "名称",
    title: "标题",
    channelId: "渠道 ID",
    channelID: "渠道 ID",
    modelId: "模型 ID",
    modelID: "模型 ID",
    resourceId: "资源 ID",
    orderId: "订单 ID",
    action: "处理方式",
    reason: "原因",
    amount: "金额 / 数量",
    credits: "积分",
    amountMicrocredits: "积分变动（微积分）",
    note: "备注",
    status: "状态",
    enabled: "是否启用",
    label: "展示名",
    channelLabel: "渠道展示名",
    displayName: "展示名",
    maxSessions: "同时运行的对话上限",
    url: "来源地址",
    version: "版本",
    ids: "对象 ID 列表",
};

export function assistantCallFields(previewJson: string): { label: string; value: string }[] {
    try {
        const source: unknown = JSON.parse(previewJson);
        if (!source || typeof source !== "object" || Array.isArray(source)) return [];
        const fields: { label: string; value: string }[] = [];
        const visit = (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) {
                // 仅展开固定的协议入参外壳，不猜测未知业务字段的含义。
                if (["req", "request", "input"].includes(key) && item && typeof item === "object" && !Array.isArray(item)) visit(item as Record<string, unknown>);
                // 超出安全整数范围的数值只在原始预览中显示，避免金融参数被浏览器舍入后误导审批。
                else if (fieldLabels[key] && !(typeof item === "number" && !Number.isSafeInteger(item)))
                    fields.push({ label: fieldLabels[key], value: typeof item === "boolean" ? (item ? "是" : "否") : typeof item === "string" ? item : JSON.stringify(item) });
            }
        };
        visit(source as Record<string, unknown>);
        return fields;
    } catch {
        return [];
    }
}
