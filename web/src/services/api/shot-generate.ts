import { apiClient, request } from "./request";

/* ------------------------------------------------------------------ *
 * D-057C —— 语义收口：浏览器侧的 project_generate_shot 不再自己实现业务规则
 *
 * 背景（D-056「单一 Domain Semantics + 双执行通道」）：
 * 本文件原先在前端自行完成「取镜头提示词 → 发现 H3 模型 → 钳时长 → 建任务」，
 * 与 D-057B 新增的 Go 服务端执行体构成**两份生产语义**——靠人肉同步，必然漂移。
 *
 * 现在两通道共用同一个后端端点：
 *   - Browser 通道：带会话 cookie 调用 `POST /api/agent/projects/:id/shots/:sid/generate`
 *   - Server  通道：canvas-agent 带 Agent 服务令牌调用同一端点
 * 后端 `RequireAgentScope` 对会话态直接放行，故浏览器可正常调用。
 *
 * 本文件只做参数整理与结果透传——**不再有任何模型发现、时长钳制或提示词组装**。
 * 语义锚点唯一：backend/internal/service/agent_shot_generation.go。
 * ------------------------------------------------------------------ */

const api = apiClient;

export type GenerateShotInput = {
    shotId: string;
    videoSeconds?: number;
    resolution?: string;
    referenceImageUrls?: string[];
    /** 镜头所属工作流的 video 步骤 id。G1 边界：只有带 stepId 的任务成功后才会自动落 shot_artifacts 产物行。 */
    workflowStepId?: string;
};

export type GenerateShotResult = {
    taskId: string;
    shotId: string;
    unitId?: string;
    model: string;
    channelId: string;
    operation: string;
    videoSeconds: number;
    resolution: string;
    status: string;
    promptSource: "revision";
    /** 执行通道标记（server / browser），便于可观测性与问题定位。 */
    executor?: string;
};

/**
 * project_generate_shot 执行体：从镜头当前修订版发起 H3 视频生成。
 * 只建任务不等待完成（与 Server 通道一致）：进度由项目工作区轮询，产物自动挂镜头。
 */
export async function generateShot(projectId: string, rawInput: GenerateShotInput): Promise<GenerateShotResult> {
    const shotId = String(rawInput.shotId || "").trim();
    const body: Record<string, unknown> = {};
    if (typeof rawInput.videoSeconds === "number" && Number.isFinite(rawInput.videoSeconds)) body.videoSeconds = rawInput.videoSeconds;
    if (rawInput.resolution?.trim()) body.resolution = rawInput.resolution.trim();
    if (rawInput.referenceImageUrls?.length) body.referenceImageUrls = rawInput.referenceImageUrls.map((item) => String(item).trim()).filter(Boolean);
    if (rawInput.workflowStepId?.trim()) body.workflowStepId = rawInput.workflowStepId.trim();

    return await request<GenerateShotResult>(
        api.post(`/agent/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/generate`, body),
    );
}
