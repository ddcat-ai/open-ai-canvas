import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Radio, Select } from "antd";
import { Upload } from "lucide-react";
import { AgentAvatarVideo } from "@/components/canvas/agent-avatar-video";
import {
    AGENT_AVATAR_STATES,
    DEFAULT_AGENT_AVATAR_CLIP_STATES,
    agentAvatarClipForState,
    isAgentAvatarBundleManifest,
    suggestedAgentAvatarClipStates,
    type AgentAvatarBundleManifest,
    type AgentAvatarState,
    type CanvasAppearance,
} from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL, uploadAgentAvatarBundle } from "@/services/api/appearance";

export function AvatarBundleEditor({ value, onChange, disabled, onUploading }: { value: CanvasAppearance; onChange: (patch: Partial<CanvasAppearance>) => void; disabled: boolean; onUploading: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<AgentAvatarState>("idle");
    const id = value.avatarBundleResourceId;
    const manifestURL = id ? agentAvatarBundleFileURL(id, "avatar.json", true) : "/doll/avatar.json";
    useEffect(() => {
        const controller = new AbortController();
        setManifest(null);
        setError("");
        void (async () => {
            try {
                const response = await fetch(manifestURL, { credentials: "include", cache: "no-store", signal: controller.signal });
                if (!response.ok) throw new Error(`读取动画包失败（HTTP ${response.status}）`);
                const data: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(data)) throw new Error("avatar.json 格式无效");
                if (!controller.signal.aborted) setManifest(data);
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取 Agent 动画包");
            }
        })();
        return () => controller.abort();
    }, [manifestURL, attempt]);
    async function upload(file?: File) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size > 128 * 1024 * 1024) {
            message.error("请选择不超过 128 MiB 的 Agent 动画 ZIP");
            return;
        }
        setUploading(true);
        onUploading(true);
        try {
            const bundle = await uploadAgentAvatarBundle(file);
            onChange({ avatarType: "bundle", avatarBundleResourceId: bundle.resourceId, avatarClipStates: suggestedAgentAvatarClipStates(bundle.manifest) });
            setState("idle");
            message.success("动画包已导入，请检查状态映射并点击页面顶部保存");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "Agent 动画包导入失败");
        } finally {
            setUploading(false);
            onUploading(false);
        }
    }
    const clip = manifest ? agentAvatarClipForState(value, state, manifest) : "";
    const file = manifest?.clips[clip];
    const src = file ? (id ? agentAvatarBundleFileURL(id, file, true) : `/doll/${encodeURIComponent(file)}`) : "";
    return (
        <div className="grid gap-3" aria-label="状态动画包设置">
            <input
                ref={input}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />
            <div className="flex flex-wrap gap-2">
                <Button icon={<Upload className="size-4" />} disabled={disabled || uploading} loading={uploading} onClick={() => input.current?.click()}>
                    导入状态动画包 ZIP（最大 128 MiB）
                </Button>
                {id ? (
                    <Button disabled={disabled || uploading} onClick={() => onChange({ avatarType: "bundle", avatarBundleResourceId: "", avatarClipStates: DEFAULT_AGENT_AVATAR_CLIP_STATES })}>
                        恢复内置动画包
                    </Button>
                ) : null}
            </div>
            <Radio.Group optionType="button" value={state} options={AGENT_AVATAR_STATES.map((item) => ({ label: item.label, value: item.id }))} onChange={(event) => setState(event.target.value)} />
            <Select
                aria-label="当前状态动画"
                value={clip || undefined}
                disabled={disabled || uploading || !manifest}
                loading={!manifest && !error}
                options={Object.entries(manifest?.clips ?? {}).map(([key, file]) => ({ label: `${key} · ${file}`, value: key }))}
                onChange={(clip) => onChange({ avatarClipStates: { ...value.avatarClipStates, [state]: clip } })}
            />
            {manifest ? (
                <p className="text-xs text-foreground/60">
                    {Object.keys(manifest.clips).length} 个动画 · {manifest.width} × {manifest.height}
                </p>
            ) : null}
            {src && manifest ? (
                <div
                    className="relative mx-auto overflow-hidden"
                    style={{ width: Math.round(manifest.width * Math.min(1, 220 / Math.max(manifest.width, manifest.height))), height: Math.round(manifest.height * Math.min(1, 220 / Math.max(manifest.width, manifest.height))) }}
                >
                    <AgentAvatarVideo src={src} loop={!["completed", "failed", "cancelled", "rejected"].includes(state)} />
                </div>
            ) : null}
            {error ? <Alert type="warning" showIcon title="动画包预览失败" description={error} action={<Button onClick={() => setAttempt((n) => n + 1)}>重试</Button>} /> : null}
        </div>
    );
}
