// 酿笑坊能力服务（nxf bridge）客户端。
// 与影策后端不同：nxf 是独立 FastAPI（默认 http://127.0.0.1:8823），
// 返回体不是 BackendEnvelope，故不走 request() 封装，直接 fetch。

const nxfBaseURL = (import.meta.env.VITE_NXF_URL as string | undefined) || "http://127.0.0.1:8823";

export type NxfCharacterSpec = { role?: string; identity?: string; state?: string };

export type NxfBeatSpec = { start: number; end: number; action: string };

export type NxfSceneSpec = {
    scene: { goal: string; location?: string; time?: string; mood?: string };
    characters?: NxfCharacterSpec[];
    visual?: { style?: string; camera?: string; lighting?: string };
    beats?: NxfBeatSpec[];
    constraints?: { identity_lock?: boolean; continuity_lock?: boolean; positive_only?: boolean };
    brief?: { platform?: string; total_seconds?: number; aspect?: string; use_case?: string };
};

export type NxfHealth = {
    bridge_version: string;
    spec_version: string;
    cards_total: number;
    cards_by_state: Record<string, number>;
    router_json_ok: boolean;
};

export type NxfRecipeHit = { name: string; score: number; why: string };

export type NxfNativeSkillHit = { tag: string; suggest: string; reason: string };

export type NxfShotContract = {
    shot: {
        title: string;
        shot_size: string;
        camera_angle: string;
        camera_movement: string;
        duration_ms: number;
        plot_description: string;
        action: string;
        dialogue?: Array<Record<string, unknown>> | null;
        action_beats: Array<{ start_ms: number; end_ms: number; action: string }>;
        continuity_notes: string;
    };
    render: {
        platform: string;
        image_prompt: string;
        video_prompt: string;
        negative_prompt: string;
    };
    gate: { verdict: "PASS" | "FAIL"; failures: string[] };
};

export type NxfCompileResult = {
    selected_recipes: NxfRecipeHit[];
    selected_native_skills: NxfNativeSkillHit[];
    adapter: { platform: string; blocks: string[] };
    shots: NxfShotContract[];
    prompts: Array<{ shot_id: string; image_prompt: string; video_prompt: string; negative_prompt: string; mode: string; warnings: string[]; issues: string[] }>;
    warnings: string[];
    coverage: { beats_mapped: number; beats_total: number; warnings: string[] };
    gate: { overall: "PASS" | "FAIL"; per_shot: Array<{ shot_id: string; verdict: "PASS" | "FAIL"; failures: string[] }> };
};

export async function nxfHealth(signal?: AbortSignal): Promise<NxfHealth> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/health`, { signal });
    if (!response.ok) throw new Error(`nxf health ${response.status}`);
    return response.json() as Promise<NxfHealth>;
}

export async function nxfSceneCompile(spec: NxfSceneSpec, topK = 5, signal?: AbortSignal): Promise<NxfCompileResult> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/scene/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, top_k: topK }),
        signal,
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`编译失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<NxfCompileResult>;
}
