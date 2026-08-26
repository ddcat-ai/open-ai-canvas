import { apiClient, request } from "@/services/api/request";
import type { RunningHubConfig, RunningHubWorkflow } from "@/stores/use-config-store";

export type RunningHubWorkflowFetchResult = RunningHubWorkflow & { kind: "workflow" | "app"; webappId?: string; raw?: Record<string, unknown> };

type FetchRequest = Pick<RunningHubConfig, "baseUrl" | "apiKey" | "walletApiKey" | "useWallet"> & { workflowId?: string; webappId?: string; title?: string; capability: RunningHubConfig["capability"] };

export function fetchRunningHubWorkflow(config: FetchRequest) {
    return request<RunningHubWorkflowFetchResult>(apiClient.post("/runninghub/workflow-info", runningHubFetchPayload(config)));
}

export function fetchRunningHubApp(config: FetchRequest) {
    return request<RunningHubWorkflowFetchResult>(apiClient.post("/runninghub/app-info", runningHubFetchPayload(config)));
}

function runningHubFetchPayload(config: FetchRequest) {
    return {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        walletApiKey: config.walletApiKey,
        useWallet: config.useWallet,
        workflowId: config.workflowId,
        webappId: config.webappId,
        title: config.title,
        capability: config.capability,
    };
}
