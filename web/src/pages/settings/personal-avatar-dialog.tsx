import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Collapse, Modal, Select, Spin } from "antd";
import { Upload } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import { AgentAvatarVideo } from "@/components/canvas/agent-avatar-video";
import { Live2DAvatar } from "@/components/canvas/live2d-avatar";
import { AGENT_AVATAR_STATES, DEFAULT_CANVAS_APPEARANCE, agentAvatarClipForState, isAgentAvatarBundleManifest, suggestedAgentAvatarClipStates, type AgentAvatarBundleManifest, type AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { agentAvatarBundleFileURL, live2DModelURL, uploadAgentAvatarBundle, uploadLive2D } from "@/services/api/appearance";
import { useAppearancePreferencesStore, type PersonalAssistantAvatar } from "@/stores/use-appearance-preferences-store";
import { useUserStore } from "@/stores/use-user-store";

const CONFIGURATION_EXAMPLE = JSON.stringify(
    {
        version: 1,
        width: 480,
        height: 432,
        clips: {
            idle: "idle.mp4",
            sleep_loop: "sleep_loop.mp4",
            working_loop: "working_loop.mp4",
            think: "think.mp4",
            wave: "wave.mp4",
            wipe_sweat: "wipe_sweat.mp4",
            lie_down: "lie_down.mp4",
            rejected: "rejected.mp4",
        },
    },
    null,
    2,
);

export function PersonalAvatarDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const reducedMotion = useReducedMotion() ?? false;
    const saved = useAppearancePreferencesStore.getState().byUser[userId]?.customAvatar;
    const [draft, setDraft] = useState<PersonalAssistantAvatar | undefined>(saved);
    const [type, setType] = useState<PersonalAssistantAvatar["type"]>(saved?.type ?? "bundle");
    const [manifest, setManifest] = useState<AgentAvatarBundleManifest | null>(null);
    const [state, setState] = useState<AgentAvatarState>("idle");
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [readyURL, setReadyURL] = useState("");
    const [attempt, setAttempt] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const selected = draft?.type === type ? draft : undefined;
    const resourceId = selected?.resourceId ?? "";
    useEffect(() => {
        setManifest(null);
        setReadyURL("");
        setError("");
        setLoading(false);
        if (type !== "bundle" || !resourceId) return;
        const controller = new AbortController();
        setLoading(true);
        void (async () => {
            try {
                const response = await fetch(agentAvatarBundleFileURL(resourceId, "avatar.json", "personal"), { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`${t("personalAvatar.previewError")} (HTTP ${response.status})`);
                const value: unknown = await response.json();
                if (!isAgentAvatarBundleManifest(value)) throw new Error(t("personalAvatar.previewError"));
                if (!controller.signal.aborted) setManifest(value);
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("personalAvatar.previewError"));
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [type, resourceId, attempt, t]);

    const clip = manifest ? agentAvatarClipForState({ ...DEFAULT_CANVAS_APPEARANCE, avatarClipStates: selected?.clipStates }, state, manifest) : "";
    const mediaURL = manifest && clip ? agentAvatarBundleFileURL(resourceId, manifest.clips[clip], "personal") : "";
    const modelURL = type === "live2d" && selected?.entry ? live2DModelURL(resourceId, selected.entry, "personal") : "";
    const previewURL = mediaURL || modelURL;
    const ready = Boolean(previewURL && previewURL === readyURL && !error && !loading);

    async function upload(file?: File) {
        if (!file || uploading) return;
        if (!file.name.toLowerCase().endsWith(".zip") || file.size <= 0 || file.size > 128 * 1024 * 1024) {
            message.error(t("personalAvatar.fileError"));
            return;
        }
        setUploading(true);
        setError("");
        try {
            const next: PersonalAssistantAvatar =
                type === "bundle"
                    ? await uploadAgentAvatarBundle(file, "personal").then((bundle) => ({ type: "bundle", resourceId: bundle.resourceId, clipStates: suggestedAgentAvatarClipStates(bundle.manifest) }))
                    : await uploadLive2D(file, "personal").then((model) => ({ type: "live2d", ...model }));
            if (!mounted.current) return;
            setDraft(next);
            setReadyURL("");
            setState("idle");
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error ? cause.message : t("personalAvatar.uploadError"));
        } finally {
            if (mounted.current) setUploading(false);
        }
    }

    function apply() {
        if (!ready || !selected || useUserStore.getState().user?.id !== userId) return;
        useAppearancePreferencesStore.getState().update(userId, { customAvatar: selected, avatar: "custom" });
        message.success(t("personalAvatar.saved"));
        onClose();
    }

    return (
        <Modal
            open
            title={t("personalAvatar.title")}
            onCancel={onClose}
            width={700}
            mask={{ closable: !uploading }}
            closable={!uploading}
            footer={
                <>
                    <Button onClick={onClose} disabled={uploading}>
                        {t("personalAvatar.close")}
                    </Button>
                    <Button type="primary" onClick={apply} disabled={!ready || uploading}>
                        {t("personalAvatar.use")}
                    </Button>
                </>
            }
        >
            <div className="grid gap-4">
                <Select
                    aria-label={t("personalAvatar.title")}
                    className="w-full"
                    value={type}
                    disabled={uploading}
                    options={[
                        { value: "bundle", label: t("personalAvatar.bundle") },
                        { value: "live2d", label: t("personalAvatar.live2d") },
                    ]}
                    onChange={(next) => {
                        setType(next);
                        setError("");
                    }}
                />
                <p className="text-sm leading-6 text-foreground/80">{t(type === "bundle" ? "personalAvatar.bundleHelp" : "personalAvatar.live2dHelp")}</p>
                {type === "bundle" ? (
                    <Collapse
                        size="small"
                        items={[
                            {
                                key: "example",
                                label: t("personalAvatar.example"),
                                children: (
                                    <div className="grid gap-3">
                                        <p className="whitespace-pre-line text-sm leading-6">{t("personalAvatar.exampleSteps")}</p>
                                        <details>
                                            <summary className="cursor-pointer text-sm">{t("personalAvatar.structure")}</summary>
                                            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-hover p-3 text-xs">{CONFIGURATION_EXAMPLE}</pre>
                                        </details>
                                    </div>
                                ),
                            },
                        ]}
                    />
                ) : null}
                <input
                    ref={input}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    aria-label={t("personalAvatar.choose")}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        void upload(file);
                    }}
                />
                <Button icon={<Upload className="size-4" />} loading={uploading} disabled={uploading} onClick={() => input.current?.click()}>
                    {t("personalAvatar.choose")}
                </Button>
                {selected ? (
                    <div className="relative mx-auto h-[280px] w-full max-w-[320px] overflow-hidden rounded-lg border border-border bg-surface-hover" aria-label={t("personalAvatar.title")}>
                        {loading ? (
                            <div className="flex h-full items-center justify-center">
                                <Spin />
                            </div>
                        ) : null}
                        {mediaURL && !error ? (
                            <AgentAvatarVideo
                                key={`${mediaURL}:${attempt}`}
                                src={mediaURL}
                                loop={["idle", "queued", "running", "waiting_approval"].includes(state)}
                                onReady={(src) => setReadyURL(src)}
                                onError={() => setError(t("personalAvatar.previewError"))}
                            />
                        ) : null}
                        {modelURL && !error ? <Live2DAvatar key={`${modelURL}:${attempt}`} url={modelURL} width={280} height={280} reducedMotion={reducedMotion} renderPriority={2} onReady={() => setReadyURL(modelURL)} onError={setError} /> : null}
                    </div>
                ) : null}
                {manifest && selected ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1 text-sm">
                            {t("personalAvatar.state")}
                            <Select
                                aria-label={t("personalAvatar.state")}
                                value={state}
                                onChange={(next) => {
                                    setState(next);
                                    setError("");
                                }}
                                options={AGENT_AVATAR_STATES.map(({ id }) => ({ value: id, label: t(`personalAvatar.states.${id}`) }))}
                            />
                        </label>
                        <label className="grid gap-1 text-sm">
                            {t("personalAvatar.clip")}
                            <Select
                                aria-label={t("personalAvatar.clip")}
                                value={clip}
                                options={Object.keys(manifest.clips).map((name) => ({ value: name, label: name }))}
                                onChange={(name) => {
                                    setDraft({ ...selected, clipStates: { ...selected.clipStates, [state]: name } });
                                    setError("");
                                }}
                            />
                        </label>
                    </div>
                ) : null}
                {error ? (
                    <Alert
                        type="error"
                        showIcon
                        title={error}
                        action={
                            <Button
                                size="small"
                                onClick={() => {
                                    setError("");
                                    setAttempt((value) => value + 1);
                                }}
                            >
                                {t("personalAvatar.retry")}
                            </Button>
                        }
                    />
                ) : null}
            </div>
        </Modal>
    );
}
