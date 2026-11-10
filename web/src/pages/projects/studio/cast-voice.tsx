import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Select } from "antd";
import { Mic, MicOff, Pause, Play, Square, Upload, X } from "lucide-react";

import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { clearDramaCastVoice, setDramaCastVoice, type DramaCast } from "@/services/api/drama";
import { listVoiceProfiles } from "@/services/api/projects";
import { getResourceAccess, resolveResourceAccessURL, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";

const VOICE_PROFILES_KEY = ["voice-profiles"] as const;
const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;
const MAX_RECORD_SECONDS = 30;
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/ogg,audio/webm,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.webm";

/** 试听服务端的声音样本；换样本或卸载时停止播放。 */
function useSamplePlayer(resourceId: string) {
    const { message } = App.useApp();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const requestRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    useEffect(() => {
        setPlaying(false);
        return () => {
            requestRef.current++;
            const audio = audioRef.current;
            if (audio) {
                audio.onended = null;
                audio.onerror = null;
                audio.pause();
                audio.removeAttribute("src");
                audio.load();
            }
            audioRef.current = null;
        };
    }, [resourceId]);
    const toggle = async () => {
        if (!resourceId) return;
        const audio = audioRef.current || (audioRef.current = new Audio());
        const version = ++requestRef.current;
        if (playing) {
            audio.pause();
            setPlaying(false);
            return;
        }
        setPlaying(true);
        try {
            const access = await getResourceAccess(resourceStorageKey(resourceId), "display", "playback");
            if (version !== requestRef.current) return;
            audio.src = resolveResourceAccessURL(access.url);
            audio.onended = () => setPlaying(false);
            audio.onerror = () => {
                setPlaying(false);
                message.error("声音样本播放失败，请重试");
            };
            await audio.play();
            if (version !== requestRef.current) audio.pause();
        } catch (error) {
            if (version !== requestRef.current) return;
            setPlaying(false);
            message.error(error instanceof Error ? error.message : "声音样本播放失败");
        }
    };
    return { playing, toggle };
}

/** 卡片与参考面板共用声音状态和试听入口。 */
export function CastVoicePreview({ resourceId, name }: { resourceId?: string; name: string }) {
    const player = useSamplePlayer(resourceId || "");
    return (
        <button
            type="button"
            className="drama-voice-preview"
            disabled={!resourceId}
            aria-label={resourceId ? `${player.playing ? "暂停" : "试听"}${name}的音频` : `${name}未绑定音频`}
            onClick={(event) => {
                event.stopPropagation();
                void player.toggle();
            }}
        >
            {player.playing ? <Pause className="size-3.5" /> : resourceId ? <Play className="size-3.5" /> : <MicOff className="size-3.5" />}
            {resourceId ? (player.playing ? "暂停试听" : "有音频 · 试听") : "无音频"}
        </button>
    );
}

/**
 * 角色声音：从声音库选一条带样本的声音，或上传 / 录制一段角色的声音。视频模型支持参考音频时，
 * 该角色开口的剧情段会带上这段样本；不支持时按声线描述生成。造型沿用所属角色的声音。
 */
export function CastVoiceField({ projectId, cast, restyle, onChanged }: { projectId: string; cast: DramaCast; restyle: boolean; onChanged: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const fileRef = useRef<HTMLInputElement>(null);
    const profilesQuery = useQuery({ queryKey: VOICE_PROFILES_KEY, queryFn: listVoiceProfiles, staleTime: 60_000 });
    // 只有带样本音频的声音能随视频请求发送；只有音色名的内置声音不列出。
    const profiles = (profilesQuery.data?.profiles || []).filter((profile) => profile.status === "active" && profile.sampleResourceId);
    const current = profiles.find((profile) => profile.id === cast.voiceProfileId);
    const sampleId = cast.voiceSampleResourceId || "";
    const player = useSamplePlayer(sampleId);
    const done = (result: { affectedSegments: number }, text: string) => {
        message.success(result.affectedSegments ? `${text}；${result.affectedSegments} 个剧情段的视频需重新生成` : text);
        void queryClient.invalidateQueries({ queryKey: VOICE_PROFILES_KEY });
        onChanged();
    };
    const bind = useMutation({
        mutationFn: (input: { voiceProfileId?: string; sampleResourceId?: string; voiceName?: string }) => setDramaCastVoice(projectId, cast.id, { ...input, restyleSegments: restyle }),
        onSuccess: (result) => done(result, "已指定角色声音"),
        onError: (error) => message.error(error instanceof Error ? error.message : "指定声音失败"),
    });
    const upload = useMutation({
        mutationFn: async ({ file, name }: { file: Blob; name: string }) => {
            const resource = await uploadResourceFile(file, "audio", { fileName: name });
            return setDramaCastVoice(projectId, cast.id, { sampleResourceId: resource.id, voiceName: name.replace(/\.[^.]+$/, "").slice(0, 60), restyleSegments: restyle });
        },
        onSuccess: (result) => done(result, "已上传并指定角色声音"),
        onError: (error) => message.error(error instanceof Error ? error.message : "上传失败"),
    });
    const clear = useMutation({
        mutationFn: () => clearDramaCastVoice(projectId, cast.id, restyle),
        onSuccess: (result) => done(result, "已清除角色声音，按声线描述生成"),
        onError: (error) => message.error(error instanceof Error ? error.message : "清除失败"),
    });
    const busy = bind.isPending || upload.isPending || clear.isPending;
    const recorder = useVoiceRecording({
        maxDuration: MAX_RECORD_SECONDS,
        onComplete: (blob) => {
            const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
            upload.mutate({ file: blob, name: `${cast.name}录音.${extension}` });
        },
    });
    useEffect(() => recorder.cancel, [projectId, cast.id, recorder.cancel]);
    const recording = recorder.state !== "idle";
    const finishRecording = () => recorder.stop();
    return (
        <div className="drama-voice">
            <div className="drama-voice-current">
                <button type="button" className="drama-voice-play" disabled={!sampleId} aria-label={sampleId ? `${player.playing ? "暂停" : "试听"}${cast.name}的声音` : "未指定声音样本"} onClick={() => void player.toggle()}>
                    {player.playing ? <Pause className="size-3.5" /> : sampleId ? <Play className="size-3.5" /> : <Mic className="size-3.5" />}
                </button>
                <span className="min-w-0 flex-1 truncate">{sampleId ? current?.name || "已指定声音样本" : "未指定声音样本，按声线描述生成"}</span>
                {sampleId ? <Button size="small" type="text" icon={<X className="size-3.5" />} loading={clear.isPending} disabled={busy && !clear.isPending} aria-label="清除角色声音" onClick={() => clear.mutate()} /> : null}
            </div>
            {recording ? (
                <div className="drama-voice-recording" role="status">
                    <span className="drama-voice-dot" aria-hidden="true" />
                    正在录音 {Math.floor(recorder.duration)} / {MAX_RECORD_SECONDS} 秒
                    <span className="flex-1" />
                    <Button size="small" onClick={() => recorder.cancel()}>
                        取消
                    </Button>
                    <Button size="small" type="primary" icon={<Square className="size-3" />} onClick={() => void finishRecording()}>
                        完成
                    </Button>
                </div>
            ) : (
                <div className="drama-voice-actions">
                    <Select
                        size="small"
                        className="min-w-0 flex-1"
                        value={current?.id ?? null}
                        placeholder={profilesQuery.isLoading ? "正在读取声音库…" : profiles.length ? "从声音库选择" : "声音库里还没有样本"}
                        options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                        disabled={busy || !profiles.length}
                        showSearch
                        optionFilterProp="label"
                        aria-label="从声音库选择"
                        onChange={(id: string | null) => {
                            if (id && id !== cast.voiceProfileId) bind.mutate({ voiceProfileId: id });
                        }}
                    />
                    <Button size="small" icon={<Upload className="size-3.5" />} loading={upload.isPending} disabled={busy && !upload.isPending} onClick={() => fileRef.current?.click()}>
                        上传
                    </Button>
                    <Button
                        size="small"
                        icon={<Mic className="size-3.5" />}
                        disabled={busy || recorder.starting}
                        loading={recorder.starting}
                        onClick={() =>
                            void recorder.start().catch(() => {
                                message.error("无法使用麦克风，请检查浏览器权限");
                            })
                        }
                    >
                        录制
                    </Button>
                </div>
            )}
            {recorder.error ? <p className="drama-voice-error">{recorder.error}</p> : null}
            <input
                ref={fileRef}
                type="file"
                accept={AUDIO_ACCEPT}
                className="hidden"
                aria-label={`上传${cast.name}的声音样本`}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (file.size > MAX_SAMPLE_BYTES) {
                        message.warning("声音样本不超过 20MB，建议 5–15 秒");
                        return;
                    }
                    upload.mutate({ file, name: file.name });
                }}
            />
        </div>
    );
}
