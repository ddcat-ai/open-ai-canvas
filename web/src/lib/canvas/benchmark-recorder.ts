/**
 * Storyboard Benchmark v1 — 录制捕获工具（debug/benchmark only）
 *
 * 仅通过localStorage debug设置启用，不影响正常用户行为。
 * 捕获localAgent turn的可观察数据：toolTrace、semantic shots、metadata。
 * 不记录密钥、API keys、chain-of-thought。
 */

const BENCHMARK_CAPTURE_KEY = "__benchmark_capture_enabled";
const BENCHMARK_FIXTURE_KEY = "__benchmark_fixture_id";
const BENCHMARK_MODE_KEY = "__benchmark_mode";

export interface BenchmarkCaptureState {
    fixtureId: string;
    mode: "baseline" | "storyboard-director";
    generatedAt: string;
    toolTrace: string[];
    shots: Array<Record<string, unknown>>;
    metadata: {
        effectiveSkillIds: string[];
        projectId?: string;
        agentRunId?: string;
        threadId?: string;
        requestedShotCount?: number;
    };
}

let currentRecording: BenchmarkCaptureState | null = null;

export function isBenchmarkCaptureEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(BENCHMARK_CAPTURE_KEY) === "1";
}

export function getBenchmarkFixtureId(): string {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(BENCHMARK_FIXTURE_KEY) ?? "";
}

export function getBenchmarkMode(): "baseline" | "storyboard-director" {
    if (typeof window === "undefined") return "storyboard-director";
    const v = window.localStorage.getItem(BENCHMARK_MODE_KEY);
    return v === "baseline" ? "baseline" : "storyboard-director";
}

export function startBenchmarkRecording(input: {
    fixtureId: string;
    mode: "baseline" | "storyboard-director";
    effectiveSkillIds: string[];
    projectId?: string;
    agentRunId?: string;
    threadId?: string;
    requestedShotCount?: number;
}): void {
    currentRecording = {
        fixtureId: input.fixtureId,
        mode: input.mode,
        generatedAt: new Date().toISOString(),
        toolTrace: [],
        shots: [],
        metadata: {
            effectiveSkillIds: input.effectiveSkillIds,
            projectId: input.projectId,
            agentRunId: input.agentRunId,
            threadId: input.threadId,
            requestedShotCount: input.requestedShotCount,
        },
    };
    console.debug("[Benchmark] recording started:", input.fixtureId, input.mode);
}

export function recordBenchmarkToolCall(toolName: string): void {
    if (!currentRecording) return;
    currentRecording.toolTrace.push(toolName);
}

export function recordBenchmarkShots(shots: Array<Record<string, unknown>>): void {
    if (!currentRecording) return;
    currentRecording.shots = shots;
    console.debug("[Benchmark] recorded", shots.length, "shots");
}

export function completeBenchmarkRecording(): BenchmarkCaptureState | null {
    if (!currentRecording) return null;
    const recording = { ...currentRecording };
    console.debug("[Benchmark] recording complete:", recording.toolTrace.length, "tools,", recording.shots.length, "shots");

    // 触发下载
    try {
        const blob = new Blob([JSON.stringify(recording, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `benchmark-${recording.fixtureId}-${recording.mode}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.debug("[Benchmark] recording downloaded");
    } catch (e) {
        console.error("[Benchmark] download failed:", e);
    }

    currentRecording = null;
    return recording;
}

export function cancelBenchmarkRecording(): void {
    currentRecording = null;
}

/**
 * 从project_create_or_update_shots的返回结果中提取semantic shots。
 * 返回格式为{shots: [{id, title, description, position, ...}]}
 */
export function extractShotsFromToolResult(result: unknown): Array<Record<string, unknown>> {
    if (!result || typeof result !== "object") return [];
    const r = result as Record<string, unknown>;
    const shots = r.shots;
    if (Array.isArray(shots)) {
        return shots.map((s) => {
            if (typeof s === "object" && s !== null) {
                const shot = s as Record<string, unknown>;
                // 只提取语义字段，不包含内部ID或敏感数据
                return {
                    position: shot.position,
                    title: shot.title,
                    description: shot.description ?? shot.plotDescription,
                    action: shot.action,
                    dialogue: shot.dialogue,
                    shotSize: shot.shotSize,
                    cameraAngle: shot.cameraAngle,
                    cameraMovement: shot.cameraMovement,
                    durationMs: shot.durationMs,
                    continuityNotes: shot.continuityNotes,
                };
            }
            return {};
        });
    }
    return [];
}
