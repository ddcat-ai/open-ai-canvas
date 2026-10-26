import { describe, expect, test } from "bun:test";

import {
    readAgentNotificationPermission,
    requestAgentBrowserNotificationPermission,
    shouldSendAgentBrowserNotification,
    showAgentBrowserNotification,
    type AgentAttention,
    type AgentNotificationHandle,
    type AgentNotificationRuntime,
} from "../src/services/agent-browser-notifications";

function runtime(overrides: Partial<AgentNotificationRuntime> = {}): AgentNotificationRuntime {
    return {
        isSecureContext: true,
        permission: "granted",
        visibilityState: "visible",
        requestPermission: async () => "granted",
        create: () => ({ onclick: null, close: () => undefined }),
        focusWindow: () => undefined,
        ...overrides,
    };
}

describe("Agent browser notification capability", () => {
    test("distinguishes insecure origins, unsupported browsers and browser permission states", () => {
        expect(readAgentNotificationPermission(runtime({ isSecureContext: false }))).toBe("insecure");
        expect(readAgentNotificationPermission(runtime({ permission: undefined, create: undefined, requestPermission: undefined }))).toBe("unsupported");
        expect(readAgentNotificationPermission(runtime({ permission: "default" }))).toBe("default");
        expect(readAgentNotificationPermission(runtime({ permission: "denied" }))).toBe("denied");
        expect(readAgentNotificationPermission(runtime({ permission: "granted" }))).toBe("granted");
    });

    test("requests permission only while the browser decision is still default", async () => {
        let requests = 0;
        const pending = runtime({
            permission: "default",
            requestPermission: async () => {
                requests += 1;
                return "granted";
            },
        });
        expect(await requestAgentBrowserNotificationPermission(pending)).toBe("granted");
        expect(requests).toBe(1);

        expect(
            await requestAgentBrowserNotificationPermission(
                runtime({
                    permission: "denied",
                    requestPermission: async () => {
                        requests += 1;
                        return "granted";
                    },
                }),
            ),
        ).toBe("denied");
        expect(requests).toBe(1);
    });
});

describe("Agent browser notification delivery policy", () => {
    test("notifies only when permission is granted and either the page is hidden or the panel is collapsed", () => {
        expect(shouldSendAgentBrowserNotification({ permission: "granted", panelOpen: true, visibilityState: "hidden" })).toBe(true);
        expect(shouldSendAgentBrowserNotification({ permission: "granted", panelOpen: false, visibilityState: "visible" })).toBe(true);
        expect(shouldSendAgentBrowserNotification({ permission: "granted", panelOpen: true, visibilityState: "visible" })).toBe(false);
        expect(shouldSendAgentBrowserNotification({ permission: "default", panelOpen: false, visibilityState: "hidden" })).toBe(false);
        expect(shouldSendAgentBrowserNotification({ permission: "denied", panelOpen: false, visibilityState: "hidden" })).toBe(false);
    });

    test("uses privacy-safe copy, a stable key tag, and opens the Agent when clicked", () => {
        const created: Array<{ title: string; options: NotificationOptions; handle: AgentNotificationHandle }> = [];
        const order: string[] = [];
        const fake = runtime({
            focusWindow: () => order.push("focus"),
            create: (title, options) => {
                const handle: AgentNotificationHandle = { onclick: null, close: () => order.push("close") };
                created.push({ title, options, handle });
                return handle;
            },
        });
        const attention: AgentAttention = { key: "approval:secret-prompt-and-node-content", kind: "approval" };

        const first = showAgentBrowserNotification(attention, () => order.push("open"), fake);
        const second = showAgentBrowserNotification(attention, () => order.push("open"), fake);

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(created.map((entry) => entry.title)).toEqual(["Agent 等待你的审批", "Agent 等待你的审批"]);
        expect(created[0]?.options.body).toBe("有一项操作等待确认，点击返回影策处理。");
        expect(created[0]?.options.tag).toBe(created[1]?.options.tag);
        expect(JSON.stringify(created[0])).not.toContain("secret-prompt-and-node-content");

        created[0]?.handle.onclick?.(new Event("click"));
        expect(order).toEqual(["focus", "open", "close"]);
    });

    test("uses separate generic question copy and refuses delivery without permission", () => {
        const created: string[] = [];
        const granted = runtime({
            create: (title) => {
                created.push(title);
                return { onclick: null, close: () => undefined };
            },
        });
        const denied = runtime({
            permission: "denied",
            create: (title) => {
                created.push(title);
                return { onclick: null, close: () => undefined };
            },
        });

        expect(showAgentBrowserNotification({ key: "question:q1", kind: "question" }, () => undefined, granted)).not.toBeNull();
        expect(showAgentBrowserNotification({ key: "question:q2", kind: "question" }, () => undefined, denied)).toBeNull();
        expect(created).toEqual(["Agent 正在等你回答"]);
    });
});
