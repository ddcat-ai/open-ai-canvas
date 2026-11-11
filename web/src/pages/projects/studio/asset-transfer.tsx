import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Input, Progress } from "antd";
import { AlertTriangle, FileArchive, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import type { DramaEpisodeRow } from "@/services/api/drama";
import { previewDramaJianyingDraft, type JianyingDraftPreview } from "@/services/api/drama-export";
import { formatBytes } from "@/lib/image-utils";
import { applyDramaAssetImport, openDramaAssetPackage, planDramaAssetImport, type DramaAssetImportOptions, type DramaAssetImportPlan, type DramaAssetImportResult, type DramaAssetPackage } from "@/services/drama-asset-import";
import { defaultJianyingDraftRoot, exportDramaAssetPackage, exportDramaJianyingDraft, jianyingDraftRootProblem, savedJianyingDraftRoot, saveJianyingDraftRoot } from "@/services/drama-export";

/** 一键打包资产：全剧设定总会打包；剧集只能选已拆出分镜的。导出不消耗积分。 */
export function AssetPackageModal({ open, projectId, episodes, onClose }: { open: boolean; projectId: string; episodes: DramaEpisodeRow[]; onClose: () => void }) {
    const { message } = App.useApp();
    const selectable = useMemo(() => episodes.filter((episode) => episode.shotCount > 0), [episodes]);
    const [picked, setPicked] = useState<Set<string> | null>(null);
    const selected = picked ?? new Set(selectable.map((episode) => episode.id));
    const [media, setMedia] = useState(true);
    const [prompts, setPrompts] = useState(true);
    const chosen = selectable.filter((episode) => selected.has(episode.id));
    const segments = chosen.reduce((sum, episode) => sum + (episode.stats.segments || 0), 0);
    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setPicked(next);
    };
    const submit = () => {
        exportDramaAssetPackage(projectId, { episodeIds: chosen.map((episode) => episode.id), media, prompts }, (text) => message.error(text));
        message.info(media ? "正在打包，浏览器会开始下载；包含视频时文件较大，请留意下载进度" : "正在打包提示词，浏览器会开始下载");
        onClose();
    };
    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(640px, calc(100vw - 32px))" rootClassName="drama-root" aria-label="一键打包全部资产">
            <div className="drama-composer drama-transfer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>一键打包全部资产</strong>
                        <span>全剧角色、场景、道具设定总会打包；剧集仅已拆解分镜的可选。导出不消耗积分。</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                </header>
                <div className="drama-transfer-body thin-scrollbar">
                    <div className="drama-transfer-row">
                        <span className="drama-composer-label">剧集</span>
                        <Button size="small" disabled={!selectable.length} onClick={() => setPicked(chosen.length === selectable.length ? new Set() : new Set(selectable.map((episode) => episode.id)))}>
                            {chosen.length === selectable.length && selectable.length ? "取消全选" : "全选"}
                        </Button>
                    </div>
                    {episodes.length ? (
                        <div className="drama-transfer-episodes" role="group" aria-label="选择剧集">
                            {episodes.map((episode) => {
                                const disabled = episode.shotCount <= 0;
                                return (
                                    <button
                                        key={episode.id}
                                        type="button"
                                        className="drama-transfer-episode"
                                        aria-pressed={selected.has(episode.id) && !disabled}
                                        disabled={disabled}
                                        title={disabled ? "还没有拆解分镜" : episode.title}
                                        onClick={() => toggle(episode.id)}
                                    >
                                        第{String(episode.number).padStart(2, "0")}集
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="drama-transfer-note">作品还没有剧集，只会打包设定。</p>
                    )}
                    <div className="drama-transfer-options">
                        <Checkbox checked={media} onChange={(event) => setMedia(event.target.checked)}>
                            媒体文件：设定参考图、角色声音样本、剧情段视频与成片
                        </Checkbox>
                        <Checkbox checked={prompts} onChange={(event) => setPrompts(event.target.checked)}>
                            提示词：段视频提示词、镜头画面与运动描述、设定参考图提示词（Markdown）
                        </Checkbox>
                    </div>
                    <p className="drama-transfer-note">压缩包内的「资产清单.json」记录全部设定与分镜结构，可在其他作品里用「导入资产包」套用设定图和提示词。</p>
                </div>
                <footer className="drama-composer-foot">
                    <span className="drama-composer-count">
                        已选 {chosen.length} 集{media && segments ? ` · 约 ${segments} 个剧情段` : ""}
                    </span>
                    <span className="flex-1" />
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={!media && !prompts} onClick={submit}>
                        确认打包
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}

const IMPORT_DEFAULTS: DramaAssetImportOptions = { castImages: true, castText: false, segmentPrompts: true, shotPrompts: false };

/** 导入资产包：按设定类型与名称、集号与段号匹配当前作品，先预览再写入。 */
export function AssetImportModal({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);
    const [pkg, setPkg] = useState<DramaAssetPackage>();
    const [fileName, setFileName] = useState("");
    const [opening, setOpening] = useState(false);
    const [options, setOptions] = useState(IMPORT_DEFAULTS);
    const [plan, setPlan] = useState<{ source: DramaAssetPackage; options: DramaAssetImportOptions; value?: DramaAssetImportPlan; error?: string }>();
    const [progress, setProgress] = useState<{ done: number; total: number }>();
    const [result, setResult] = useState<DramaAssetImportResult>();
    const importing = Boolean(progress) && !result;
    const prompts = pkg?.manifest.includes?.prompts === true;

    useEffect(() => {
        if (!pkg || result) return;
        let active = true;
        planDramaAssetImport(projectId, pkg, options)
            .then((value) => active && setPlan({ source: pkg, options, value }))
            .catch((error) => active && setPlan({ source: pkg, options, error: error instanceof Error ? error.message : "读取当前作品失败" }));
        return () => {
            active = false;
        };
    }, [options, pkg, projectId, result]);
    const currentPlan = plan?.source === pkg && plan?.options === options ? plan : undefined;

    const reset = () => {
        setPkg(undefined);
        setFileName("");
        setPlan(undefined);
        setProgress(undefined);
        setResult(undefined);
        setOptions(IMPORT_DEFAULTS);
    };
    const close = () => {
        if (importing) return;
        reset();
        onClose();
    };
    const choose = async (file: File | undefined) => {
        if (!file) return;
        setOpening(true);
        try {
            const opened = await openDramaAssetPackage(file);
            setPkg(opened);
            setFileName(file.name);
            setPlan(undefined);
            setResult(undefined);
            setProgress(undefined);
            const hasPrompts = opened.manifest.includes?.prompts === true;
            setOptions({ ...IMPORT_DEFAULTS, segmentPrompts: hasPrompts, shotPrompts: false });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法读取资产包");
        } finally {
            setOpening(false);
        }
    };
    const run = async () => {
        if (!pkg || !currentPlan?.value?.operations.length) return;
        setProgress({ done: 0, total: currentPlan.value.operations.length });
        const outcome = await applyDramaAssetImport(projectId, pkg, currentPlan.value, (done, total) => setProgress({ done, total }));
        setResult(outcome);
        void queryClient.invalidateQueries({ queryKey: dramaKeys.summary(projectId) });
        if (outcome.failed.length) message.warning(`已导入 ${outcome.succeeded} 项，${outcome.failed.length} 项失败`);
        else message.success(`已导入 ${outcome.succeeded} 项`);
    };
    const counts = useMemo(() => {
        const operations = currentPlan?.value?.operations || [];
        return {
            images: operations.filter((item) => item.kind === "cast-image").length,
            texts: operations.filter((item) => item.kind === "cast-text").length,
            segments: operations.filter((item) => item.kind === "segment-prompt").length,
            shots: operations.filter((item) => item.kind === "shot-prompt").length,
        };
    }, [currentPlan]);
    const option = (key: keyof DramaAssetImportOptions) => ({ checked: options[key], disabled: importing || Boolean(result), onChange: (event: { target: { checked: boolean } }) => setOptions({ ...options, [key]: event.target.checked }) });

    return (
        <AppModal open={open} onCancel={close} footer={null} title={null} closable={false} flush centered width="min(680px, calc(100vw - 32px))" rootClassName="drama-root" aria-label="导入资产包">
            <div className="drama-composer drama-transfer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>导入资产包</strong>
                        <span>把影策导出的资产包套用到当前作品：按类型与名称匹配设定，按集号与段号匹配提示词。</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" disabled={importing} onClick={close} />
                </header>
                <div className="drama-transfer-body thin-scrollbar">
                    <input
                        ref={inputRef}
                        type="file"
                        accept=".zip,application/zip"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            void choose(file);
                        }}
                    />
                    <div className="drama-transfer-file">
                        <FileArchive className="size-5 shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1">
                            {pkg ? (
                                <>
                                    <strong title={fileName}>{fileName}</strong>
                                    <span>
                                        来自「{pkg.manifest.drama.name}」 · {pkg.manifest.cast.length} 个设定 · {pkg.manifest.episodes.length} 集{prompts ? " · 含提示词" : " · 不含提示词"}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <strong>选择资产包（.zip）</strong>
                                    <span>只读取资产清单和需要的图片，大文件也不会整包载入。</span>
                                </>
                            )}
                        </div>
                        <Button loading={opening} disabled={importing} onClick={() => inputRef.current?.click()}>
                            {pkg ? "重新选择" : "选择文件"}
                        </Button>
                    </div>
                    {pkg ? (
                        <>
                            <div className="drama-transfer-options">
                                <Checkbox {...option("castImages")}>设定参考图：替换同名设定的当前参考图（旧图保留在版本记录里）</Checkbox>
                                <Checkbox {...option("castText")}>设定外观与简介：覆盖同名设定的文字</Checkbox>
                                <Checkbox {...option("segmentPrompts")} disabled={!prompts || importing || Boolean(result)}>
                                    剧情段视频提示词：写入为同集同段的自定义提示词
                                </Checkbox>
                                <Checkbox {...option("shotPrompts")} disabled={!prompts || importing || Boolean(result)}>
                                    镜头画面与运动描述：仅分镜数量一致的集
                                </Checkbox>
                            </div>
                            <p className="drama-transfer-note">已生成的剧情段视频不会自动重做；提示词里的「参考图N」编号沿用原作品，导入后请核对。视频与声音样本不导入。</p>
                            <div className="drama-transfer-plan" role="status">
                                {currentPlan?.error ? (
                                    <span className="drama-transfer-problem">
                                        <AlertTriangle className="size-4 shrink-0" />
                                        {currentPlan.error}
                                    </span>
                                ) : !currentPlan ? (
                                    <span>正在对照当前作品…</span>
                                ) : (
                                    <span>
                                        将写入 {currentPlan.value!.operations.length} 项：参考图 {counts.images} · 设定文字 {counts.texts} · 段提示词 {counts.segments} · 镜头提示词 {counts.shots}
                                    </span>
                                )}
                                {progress ? <Progress percent={Math.round((progress.done / Math.max(progress.total, 1)) * 100)} size="small" /> : null}
                                {currentPlan?.value?.skipped.length ? (
                                    <details>
                                        <summary>跳过 {currentPlan.value.skipped.length} 项</summary>
                                        <ul>
                                            {currentPlan.value.skipped.map((item) => (
                                                <li key={item}>{item}</li>
                                            ))}
                                        </ul>
                                    </details>
                                ) : null}
                                {result?.failed.length ? (
                                    <details open>
                                        <summary>失败 {result.failed.length} 项</summary>
                                        <ul>
                                            {result.failed.map((item) => (
                                                <li key={item.label}>
                                                    {item.label}：{item.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                ) : null}
                            </div>
                        </>
                    ) : null}
                </div>
                <footer className="drama-composer-foot">
                    <span className="drama-composer-count">{result ? `完成：成功 ${result.succeeded} 项${result.failed.length ? `，失败 ${result.failed.length} 项` : ""}` : progress ? `正在导入 ${progress.done}/${progress.total}` : ""}</span>
                    <span className="flex-1" />
                    {result ? (
                        <Button type="primary" onClick={close}>
                            完成
                        </Button>
                    ) : (
                        <>
                            <Button disabled={importing} onClick={close}>
                                取消
                            </Button>
                            <Button type="primary" loading={importing} disabled={!currentPlan?.value?.operations.length} onClick={() => void run()}>
                                开始导入
                            </Button>
                        </>
                    )}
                </footer>
            </div>
        </AppModal>
    );
}

/** 先检查媒体与导入目录，再交给浏览器流式下载；页面无法观察附件下载完成。 */
export function JianyingDraftModal({ open, projectId, episodeId, episodeLabel, onClose }: { open: boolean; projectId: string; episodeId: string; episodeLabel: string; onClose: () => void }) {
    const [root, setRoot] = useState(() => savedJianyingDraftRoot() || defaultJianyingDraftRoot());
    const [captions, setCaptions] = useState(true);
    const [preview, setPreview] = useState<JianyingDraftPreview | null>(null);
    const [checking, setChecking] = useState(false);
    const [requested, setRequested] = useState(false);
    const [error, setError] = useState("");
    const [allowIncomplete, setAllowIncomplete] = useState(false);
    const [allowStale, setAllowStale] = useState(false);
    const lock = useRef(false);
    const submitted = useRef(false);
    const request = useRef<AbortController | null>(null);
    const download = useRef<ReturnType<typeof exportDramaJianyingDraft> | null>(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        setPreview(null);
        setRequested(false);
        setChecking(false);
        setError("");
        lock.current = false;
        submitted.current = false;
        return () => {
            alive.current = false;
            request.current?.abort();
            download.current?.stopObserving();
        };
    }, [projectId, episodeId, open]);
    const problem = jianyingDraftRootProblem(root);
    const invalidate = () => {
        submitted.current = false;
        setPreview(null);
        setRequested(false);
        setError("");
        setAllowIncomplete(false);
        setAllowStale(false);
    };
    const inspect = async () => {
        if (problem || lock.current) return;
        lock.current = true;
        setChecking(true);
        invalidate();
        download.current?.stopObserving();
        const controller = new AbortController();
        request.current?.abort();
        request.current = controller;
        try {
            const result = await previewDramaJianyingDraft(projectId, episodeId, { draftRoot: root.trim(), captions }, controller.signal);
            if (controller.signal.aborted || !alive.current) return;
            setRoot(result.draftRoot);
            setPreview(result);
        } catch (cause) {
            if (!controller.signal.aborted && alive.current) setError(cause instanceof Error ? cause.message : "检查失败，请重试");
        } finally {
            if (request.current === controller) {
                lock.current = false;
                if (alive.current) setChecking(false);
            }
        }
    };
    const canDownload = Boolean(preview?.availableSegments && (!preview.missingSegments || allowIncomplete) && (!preview.staleSegments || allowStale));
    const submit = () => {
        if (problem || !preview || !canDownload || submitted.current || lock.current) return;
        lock.current = true;
        submitted.current = true;
        setRequested(true);
        setError("");
        saveJianyingDraftRoot(root);
        const fail = (text: string) => {
            if (!alive.current) return;
            setError(text);
            setRequested(false);
            setPreview(null);
            lock.current = false;
            submitted.current = false;
        };
        try {
            download.current = exportDramaJianyingDraft(projectId, episodeId, { draftRoot: preview.draftRoot, captions, revision: preview.revision, allowIncomplete, allowStale }, fail);
        } catch (cause) {
            fail(cause instanceof Error ? cause.message : "浏览器没有提交下载，请重新检查后重试");
        } finally {
            lock.current = false;
        }
    };
    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(720px, calc(100vw - 32px))" rootClassName="drama-root" aria-label="导出剪映草稿">
            <div className="drama-composer drama-transfer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>导出剪映草稿 · {episodeLabel}</strong>
                        <span>先检查可用视频、缺段和旧版本，再按剧情段顺序交给剪映继续剪辑。</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                </header>
                <div className="drama-transfer-body thin-scrollbar">
                    <label className="drama-composer-field">
                        <span className="drama-composer-label">本机剪映草稿目录</span>
                        <Input
                            aria-label="本机剪映草稿目录"
                            value={root}
                            disabled={checking || requested}
                            onChange={(event) => {
                                setRoot(event.target.value);
                                invalidate();
                            }}
                            status={problem ? "warning" : undefined}
                            spellCheck={false}
                        />
                        <span className={problem ? "drama-transfer-problem" : "drama-transfer-note"}>{problem || "从剪映设置中复制实际草稿位置。此路径会随导出请求发送，用于生成素材引用；服务器不会访问你的电脑，也不保存该目录配置。"}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            size="small"
                            disabled={checking || requested}
                            onClick={() => {
                                setRoot(defaultJianyingDraftRoot("windows"));
                                invalidate();
                            }}
                        >
                            Windows 路径示例
                        </Button>
                        <Button
                            size="small"
                            disabled={checking || requested}
                            onClick={() => {
                                setRoot(defaultJianyingDraftRoot("macos"));
                                invalidate();
                            }}
                        >
                            macOS 路径示例
                        </Button>
                    </div>
                    <div className="drama-transfer-options">
                        <Checkbox
                            checked={captions}
                            disabled={checking || requested}
                            onChange={(event) => {
                                setCaptions(event.target.checked);
                                invalidate();
                            }}
                        >
                            附带台词字幕轨及 SRT（分镜估时，导入后需核对）
                        </Checkbox>
                    </div>
                    {error ? (
                        <p className="drama-transfer-problem" role="alert">
                            {error}
                        </p>
                    ) : null}
                    {preview ? (
                        <div className="drama-transfer-plan" role="status">
                            <strong>
                                可导出 {preview.availableSegments} / {preview.totalSegments} 段 · {(preview.durationMs / 1000).toFixed(1)} 秒 · 媒体约 {formatBytes(preview.mediaBytes)}
                            </strong>
                            {!preview.availableSegments ? <p className="drama-transfer-problem">没有可导出的视频，请先生成或修复下列素材后重新检查。</p> : null}
                            {preview.warnings.length ? (
                                <ul>
                                    {preview.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p>已检查所选视频的资源记录与读取状态。下载时仍会再次核对。</p>
                            )}
                            <details open={preview.missingSegments > 0 || preview.staleSegments > 0}>
                                <summary>查看剧情段清单</summary>
                                <ul>
                                    {preview.segments.map((segment) => (
                                        <li key={segment.index}>
                                            第 {segment.index + 1} 段 · {segment.title}：
                                            {segment.included ? `${(segment.durationMs / 1000).toFixed(1)} 秒${segment.stale ? " · 旧版本" : ""}${segment.durationEstimated ? " · 时长估算" : ""}` : segment.reason}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                            <div className="drama-transfer-options">
                                {preview.missingSegments > 0 ? (
                                    <Checkbox checked={allowIncomplete} disabled={requested} onChange={(event) => setAllowIncomplete(event.target.checked)}>
                                        确认跳过 {preview.missingSegments} 个不可用剧情段，仅导出当前可用片段
                                    </Checkbox>
                                ) : null}
                                {preview.staleSegments > 0 ? (
                                    <Checkbox checked={allowStale} disabled={requested} onChange={(event) => setAllowStale(event.target.checked)}>
                                        确认使用 {preview.staleSegments} 个剧情段的旧版本视频
                                    </Checkbox>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                    {requested ? (
                        <p className="drama-transfer-note" role="status">
                            已提交下载请求。请在浏览器下载列表确认是否开始、进度和最终结果；页面无法确认文件已下载完成。可以关闭此窗口，下载仍由浏览器处理。
                        </p>
                    ) : null}
                    <ol className="drama-transfer-steps">
                        <li>下载完成后关闭剪映，将 ZIP 解压到填写的目录；导出的草稿文件夹直接放在该目录下，不要改名，也不要多套一层文件夹。</li>
                        <li>重新打开剪映，尝试从草稿列表打开同名草稿。不同客户端版本可能不识别外部草稿，尚未保证全部版本兼容。</li>
                        <li>若提示素材丢失，重新链接草稿内 materials 文件夹；若草稿无法识别，仍可按文件名顺序导入其中的视频及台词字幕.srt。</li>
                    </ol>
                </div>
                <footer className="drama-composer-foot">
                    <span className="flex-1" />
                    <Button onClick={onClose}>{requested ? "关闭" : "取消"}</Button>
                    {requested ? (
                        <Button onClick={() => void inspect()}>未收到下载，重新检查</Button>
                    ) : preview ? (
                        <>
                            <Button onClick={() => void inspect()}>重新检查</Button>
                            <Button type="primary" disabled={!canDownload} onClick={submit}>
                                确认并请求下载
                            </Button>
                        </>
                    ) : (
                        <Button type="primary" loading={checking} disabled={Boolean(problem)} onClick={() => void inspect()}>
                            检查导出内容
                        </Button>
                    )}
                </footer>
            </div>
        </AppModal>
    );
}
