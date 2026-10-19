import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { agentAvatarClipForState, agentAvatarStateForRunStatus, isAgentAvatarBundleManifest, type AgentAvatarBundleManifest, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import type { SpriteRunState } from "@/lib/canvas/sprite-pet";
import { agentAvatarBundleFileURL } from "@/services/api/appearance";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { FluidOrb } from "@/components/ui/fluid-orb";

export function PetBundleAvatar({ appearance, height, paused, state, onReady, onError }: { appearance: CanvasAppearance; height: number; paused: boolean; state?: SpriteRunState; onReady?: () => void; onError?: (error: string) => void }) {
    const revision = useAppearanceStore((s) => s.appearance.revision);
    const id = appearance.avatarBundleResourceId;
    const url = id ? agentAvatarBundleFileURL(id, "avatar.json", false, revision) : "/doll/avatar.json";
    const [loaded, setLoaded] = useState<{ url: string; manifest: AgentAvatarBundleManifest | null; error: boolean } | null>(null);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch(url, { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`无法读取 Agent 动画包（HTTP ${response.status}）`);
                const manifest: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(manifest)) throw new Error("avatar.json 格式无效");
                if (!controller.signal.aborted) setLoaded({ url, manifest, error: false });
            } catch (error) {
                if (!controller.signal.aborted) {
                    setLoaded({ url, manifest: null, error: true });
                    callbacks.current.onError?.(error instanceof Error ? error.message : "动画包加载失败");
                }
            }
        })();
        return () => controller.abort();
    }, [url]);
    const current = loaded?.url === url ? loaded : null;
    if (!current)
        return (
            <span role="status" aria-busy="true">
                <LoaderCircle className="size-6 motion-safe:animate-spin" />
                <span className="sr-only">正在加载助手形象</span>
            </span>
        );
    if (current.error || !current.manifest) return <FluidOrb size={Math.min(60, height)} />;
    const manifest = current.manifest;
    const status = state?.cleanupPending ? "running" : state?.approvalPending || state?.waitingUser ? "waiting_approval" : agentAvatarStateForRunStatus(state?.status || "idle");
    const clip = agentAvatarClipForState(appearance, status, manifest),
        file = manifest.clips[clip];
    const src = id ? agentAvatarBundleFileURL(id, file, false, revision) : `/doll/${encodeURIComponent(file)}`;
    const scale = height / Math.max(manifest.width, manifest.height);
    return (
        <span style={{ position: "relative", display: "block", width: manifest.width * scale, height: manifest.height * scale }}>
            <AgentAvatarVideo
                src={src}
                paused={paused}
                loop={!["completed", "failed", "cancelled", "rejected"].includes(status)}
                onReady={() => callbacks.current.onReady?.()}
                onError={() => {
                    setLoaded({ url, manifest: null, error: true });
                    callbacks.current.onError?.("动画播放失败");
                }}
            />
        </span>
    );
}
