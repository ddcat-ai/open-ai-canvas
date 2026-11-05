import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, Input, Progress } from "antd";
import { AlertTriangle, FileArchive, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import type { DramaEpisodeRow } from "@/services/api/drama";
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

/** 导出剪映草稿：素材按用户本机的剪映草稿目录写成绝对路径，解压到该目录后剪映首页即可打开。 */
export function JianyingDraftModal({ open, projectId, episodeId, episodeLabel, readySegments, onClose }: { open: boolean; projectId: string; episodeId: string; episodeLabel: string; readySegments: number; onClose: () => void }) {
    const { message } = App.useApp();
    const [root, setRoot] = useState(() => savedJianyingDraftRoot() || defaultJianyingDraftRoot());
    const [captions, setCaptions] = useState(true);
    const problem = jianyingDraftRootProblem(root);
    const submit = () => {
        if (problem) return;
        saveJianyingDraftRoot(root);
        exportDramaJianyingDraft(projectId, episodeId, { draftRoot: root, captions }, (text) => message.error(text));
        message.info("正在生成剪映草稿，浏览器会开始下载");
        onClose();
    };
    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} flush centered width="min(640px, calc(100vw - 32px))" rootClassName="drama-root" aria-label="导出剪映草稿">
            <div className="drama-composer drama-transfer">
                <header className="drama-composer-head">
                    <div className="min-w-0">
                        <strong>导出剪映草稿 · {episodeLabel}</strong>
                        <span>{readySegments} 个剧情段视频按成片顺序排在主轨上，下载后解压到剪映草稿目录即可直接打开。</span>
                    </div>
                    <Button type="text" icon={<X className="size-4" />} aria-label="关闭" onClick={onClose} />
                </header>
                <div className="drama-transfer-body thin-scrollbar">
                    <label className="drama-composer-field">
                        <span className="drama-composer-label">剪映草稿目录</span>
                        <Input value={root} onChange={(event) => setRoot(event.target.value)} status={problem ? "warning" : undefined} spellCheck={false} />
                        <span className={problem ? "drama-transfer-problem" : "drama-transfer-note"}>{problem || "在剪映专业版「全局设置 → 草稿位置」查看。素材路径按这个目录写入草稿，只保存在本机浏览器。"}</span>
                    </label>
                    <div className="drama-transfer-options">
                        <Checkbox checked={captions} onChange={(event) => setCaptions(event.target.checked)}>
                            附带台词字幕轨（按分镜时长估算，同时附 SRT 文件）
                        </Checkbox>
                    </div>
                    <ol className="drama-transfer-steps">
                        <li>关闭剪映，把下载的压缩包解压到上面的目录，草稿文件夹要直接位于该目录下，不要改名。</li>
                        <li>重新打开剪映，在首页草稿列表里打开同名草稿。</li>
                        <li>素材显示丢失时，说明解压位置与目录不一致，可在剪映里重新链接草稿内 materials 目录的视频。</li>
                    </ol>
                </div>
                <footer className="drama-composer-foot">
                    <span className="flex-1" />
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={Boolean(problem) || !readySegments} onClick={submit}>
                        导出草稿
                    </Button>
                </footer>
            </div>
        </AppModal>
    );
}
