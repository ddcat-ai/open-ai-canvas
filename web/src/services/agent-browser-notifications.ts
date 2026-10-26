export type AgentAttention = {
    key: string;
    kind: "approval" | "question";
};

export type AgentNotificationPermissionState = NotificationPermission | "insecure" | "unsupported";

export type AgentNotificationHandle = {
    onclick: ((event: Event) => void) | null;
    close: () => void;
};

export type AgentNotificationRuntime = {
    isSecureContext: boolean;
    permission?: NotificationPermission;
    visibilityState: DocumentVisibilityState;
    requestPermission?: () => Promise<NotificationPermission>;
    create?: (title: string, options: NotificationOptions) => AgentNotificationHandle;
    focusWindow: () => void;
};

function browserNotificationRuntime(): AgentNotificationRuntime {
    const notificationApi = typeof Notification === "undefined" ? undefined : Notification;
    return {
        isSecureContext: typeof window === "undefined" || window.isSecureContext !== false,
        permission: notificationApi?.permission,
        visibilityState: typeof document === "undefined" ? "visible" : document.visibilityState,
        requestPermission: notificationApi ? () => notificationApi.requestPermission() : undefined,
        create: notificationApi ? (title, options) => new notificationApi(title, options) : undefined,
        focusWindow: () => {
            if (typeof window !== "undefined") window.focus();
        },
    };
}

export function readAgentNotificationPermission(runtime: AgentNotificationRuntime = browserNotificationRuntime()): AgentNotificationPermissionState {
    if (!runtime.isSecureContext) return "insecure";
    if (!runtime.permission || !runtime.create) return "unsupported";
    return runtime.permission;
}

export function shouldSendAgentBrowserNotification(input: { permission: AgentNotificationPermissionState; panelOpen: boolean; visibilityState: DocumentVisibilityState }) {
    return input.permission === "granted" && (!input.panelOpen || input.visibilityState === "hidden");
}

export async function requestAgentBrowserNotificationPermission(runtime: AgentNotificationRuntime = browserNotificationRuntime()): Promise<AgentNotificationPermissionState> {
    const current = readAgentNotificationPermission(runtime);
    if (current !== "default") return current;
    if (!runtime.requestPermission) return "unsupported";
    return await runtime.requestPermission();
}

function notificationCopy(kind: AgentAttention["kind"]) {
    return kind === "approval" ? { title: "Agent 等待你的审批", body: "有一项操作等待确认，点击返回影策处理。" } : { title: "Agent 正在等你回答", body: "有一个问题需要你的选择，点击返回影策处理。" };
}

export function showAgentBrowserNotification(attention: AgentAttention, onOpen: () => void, runtime: AgentNotificationRuntime = browserNotificationRuntime()): AgentNotificationHandle | null {
    if (readAgentNotificationPermission(runtime) !== "granted" || !runtime.create) return null;
    const copy = notificationCopy(attention.kind);
    try {
        const notification = runtime.create(copy.title, {
            body: copy.body,
            tag: "yingce-agent-attention",
        });
        notification.onclick = () => {
            runtime.focusWindow();
            onOpen();
            notification.close();
        };
        return notification;
    } catch {
        return null;
    }
}
