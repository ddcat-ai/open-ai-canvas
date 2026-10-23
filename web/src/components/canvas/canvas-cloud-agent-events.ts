// 历史恢复复用相同归约，但不触发浏览器预演等实时副作用。
import { applyAgentEvent as reduceAgentEvent } from "@/lib/canvas/cloud-agent-events";
export * from "@/lib/canvas/cloud-agent-events";

export const applyAgentEvent: typeof reduceAgentEvent = (event, setMessages, setRun, setApproval, setPrompt) =>
    reduceAgentEvent(event, setMessages, setRun, setApproval, setPrompt, (detail) => {
        window.dispatchEvent(new CustomEvent("previs:preview-requested", { detail }));
    });
