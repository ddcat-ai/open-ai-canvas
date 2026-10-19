import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { collectLibTVStepPrompts, createLatestRequestGuard, ensureRemoteLibTVCanvasDraft, pickLibTVRecommendations, rankLibTVGalleryTags, resolveLibTVReplicationPlan, type LibTVCanvasDraftDeps } from "../src/lib/libtv-gallery";
import { describeLibTVStepMedia, StepMediaPreview } from "../src/pages/inspiration/step-media-preview";
import { LibTVStepDetails } from "../src/pages/inspiration/step-media-dialog";
import type { LibTVWorkStep } from "../src/types/libtv-gallery";

// 媒体地址均为占位，不含真实用户作品。
const IMAGE = "https://libtv-res.liblib.art/fixture/step.png";
const VIDEO = "https://libtv-res.liblib.art/fixture/step.mp4";
const AUDIO = "https://libtv-res.liblib.art/fixture/step.mp3";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

function step(overrides: Partial<LibTVWorkStep> = {}): LibTVWorkStep {
    return {
        id: "node-1",
        title: "主图",
        type: "image",
        prompt: "雨夜霓虹街道",
        text: "",
        model: "libtv-model-x",
        mediaUrls: [IMAGE],
        aspectRatio: "16:9",
        resolution: "2K",
        durationSeconds: 0,
        referenceNodeIds: [],
        ...overrides,
    };
}

function render(item: LibTVWorkStep) {
    return renderToStaticMarkup(<StepMediaPreview step={item} alt="步骤" />);
}

describe("LibTV work step media preview", () => {
    test("video keeps the external source with controls, a first-frame poster, preload none and no autoplay", () => {
        const media = describeLibTVStepMedia(step({ type: "video", mediaUrls: [VIDEO] }));
        expect(media).toEqual({ kind: "video", src: VIDEO, poster: `${VIDEO}?x-oss-process=video%2Fsnapshot%2Ct_0%2Cf_jpg%2Cw_400%2Cm_fast%2Car_auto` });

        const html = render(step({ type: "video", mediaUrls: [VIDEO] }));
        expect(html).toContain("<video");
        expect(html).toContain('controls=""');
        expect(html).toContain('preload="none"');
        expect(html).toContain(`src="${VIDEO}"`);
        expect(html).toContain('poster="https://libtv-res.liblib.art/fixture/step.mp4?x-oss-process=video%2Fsnapshot');
        expect(html).not.toContain("autoplay");
        expect(html).not.toContain("autoPlay");
        expect(html).not.toContain("<img");
    });

    test("video outside the LibTV resource host gets no invented poster", () => {
        expect(describeLibTVStepMedia(step({ type: "video", mediaUrls: ["https://example.com/a.mp4"] }))).toEqual({ kind: "video", src: "https://example.com/a.mp4", poster: undefined });
        expect(render(step({ type: "video", mediaUrls: ["https://example.com/a.mp4"] }))).not.toContain("poster=");
    });

    test("audio renders an audio player, never an image", () => {
        const html = render(step({ type: "audio", mediaUrls: [AUDIO] }));
        expect(html).toContain("<audio");
        expect(html).toContain('controls=""');
        expect(html).toContain('preload="none"');
        expect(html).toContain(`src="${AUDIO}"`);
        expect(html).not.toContain("<img");
        expect(html).not.toContain("autoplay");
    });

    test("image uses the existing LibTV thumbnail helper and lazy loading", () => {
        const html = render(step());
        expect(html).toContain("<img");
        expect(html).toContain('src="https://libtv-res.liblib.art/fixture/step.png?x-oss-process=image%2Fresize%2Cw_960"');
        expect(html).toContain('loading="lazy"');
        expect(describeLibTVStepMedia(step({ mediaUrls: ["https://example.com/a.png"] }))).toEqual({ kind: "image", src: "https://example.com/a.png", originalUrl: "https://example.com/a.png" });
    });

    test("image load failure leaves the spinner for a fallback with the original external link", () => {
        const preview = source("../src/pages/inspiration/step-media-preview.tsx");
        expect(preview).toContain('onError={() => setStatus("error")}');
        expect(preview).toContain('if (status === "error")');
        expect(preview).toContain("图片加载失败");
        expect(preview).toContain("href={originalUrl}");
    });

    test("text steps and steps without media render no media element", () => {
        expect(render(step({ type: "text", text: "旁白", mediaUrls: [IMAGE] }))).toBe("");
        expect(render(step({ mediaUrls: [] }))).toBe("");
        expect(render(step({ mediaUrls: ["  "] }))).toBe("");
    });

    test("full image preview uses the original external image and shows the entire frame", () => {
        const html = renderToStaticMarkup(<StepMediaPreview step={step()} alt="大图" full />);
        expect(html).toContain(`src="${IMAGE}"`);
        expect(html).toContain('loading="eager"');
        expect(html).toContain("object-contain");
        expect(html).not.toContain("x-oss-process");
        expect(html).not.toContain("sm:w-[200px]");
    });

    test("full video preview keeps playback on demand without cropping", () => {
        const html = renderToStaticMarkup(<StepMediaPreview step={step({ type: "video", mediaUrls: [VIDEO] })} alt="视频" full />);
        expect(html).toContain(`src="${VIDEO}"`);
        expect(html).toContain('controls=""');
        expect(html).toContain('preload="none"');
        expect(html).toContain("object-contain");
        expect(html).not.toContain("autoplay");
        expect(html).not.toContain("sm:w-[200px]");
    });

    test("narrow screens stack media above the step text instead of squeezing it", () => {
        const audio = render(step({ type: "audio", mediaUrls: [AUDIO] }));
        expect(audio).toContain("w-full");
        expect(audio).toContain("sm:w-[280px]");
        expect(audio).not.toContain("width:280px");
        for (const html of [render(step()), render(step({ type: "video", mediaUrls: [VIDEO] }))]) {
            expect(html).toContain("w-full");
            expect(html).toContain("sm:w-[200px]");
            expect(html).not.toContain("width:200px");
        }
    });

    test("production summaries never append single or all step details below the list", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        expect(detail).not.toContain("stepView");
        expect(detail).not.toContain("stepDetailsRef");
        expect(detail).not.toContain("data-step-detail");
        expect(detail).not.toContain("<StepCard");
        expect(detail).not.toContain("展开全部 ${data.steps.length}");
        const processSection = detail.slice(detail.indexOf('<section className="mt-4" ref={processRef}>'), detail.indexOf("{warningGroups.length > 0"));
        expect(processSection).toContain("max-h-[min(48dvh,420px)]");
        expect(processSection).toContain("overflow-y-auto overscroll-contain");
        expect(processSection).not.toContain("<StepMediaPreview");
    });

    test("process entry locates summaries and replication opens details inside the media dialog", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        expect(detail).toContain('processRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })');
        const handler = detail.slice(detail.indexOf("const handleReplicateVideo"), detail.indexOf("const handleMakeSame"));
        expect(handler).toContain("openStep(plan.options[0].step.id)");
        const dialog = source("../src/pages/inspiration/step-media-dialog.tsx");
        expect(dialog).toContain("onClick={() => setDetailsExpanded((expanded) => !expanded)}");
        expect(dialog).toContain("const [detailsExpanded, setDetailsExpanded] = useState(true)");
        expect(dialog).not.toContain("onViewDetails");
        expect(dialog).not.toContain("scrollIntoView");
        expect(dialog).toContain("overflow-y-auto overscroll-contain");
        expect(dialog).toContain("md:flex-row");
    });
});

describe("LibTV step detail content", () => {
    const renderDetails = (item: LibTVWorkStep, steps: LibTVWorkStep[] = []) => renderToStaticMarkup(<LibTVStepDetails step={item} steps={steps} onMakeSame={() => {}} />);

    test("details preserve long prompts and all supplied parameters without clipping", () => {
        const prompt = `开场\n${"镜头跟随人物。".repeat(100)}\n最后一个镜头`;
        const html = renderDetails(step({ prompt, durationSeconds: 5 }));
        for (const text of [prompt, "libtv-model-x", "16:9", "2K", "5 秒", "做同款"]) expect(html).toContain(text);
        expect(html).not.toContain("line-clamp");
    });

    test("references use published names, dedupe, and report unavailable references honestly", () => {
        const html = renderDetails(step({ referenceNodeIds: ["reference-1", "reference-1", "unpublished-id"] }), [step({ id: "reference-1", title: "嫩苗参考图" })]);
        expect(html).toContain("引用 · 2");
        expect(html).toContain("嫩苗参考图");
        expect(html).toContain("1 个引用未公开详情");
        expect(html).not.toContain("unpublished-id");
        expect(html).not.toContain("做同款");
        expect(html).toContain("复制到画布");
    });

    test("text-only steps show text with no invented media or generation action", () => {
        const html = renderDetails(step({ type: "text", prompt: "", text: "完整旁白\n第二段", mediaUrls: [] }));
        expect(html).toContain("完整旁白\n第二段");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<video");
        expect(html).not.toContain("做同款");
    });

    test("unpublished prompts and references have explicit empty states", () => {
        const html = renderDetails(step({ prompt: "", referenceNodeIds: [] }));
        expect(html).toContain("此步骤未公开提示词。");
        expect(html).toContain("未公开关联引用。");
        expect(html).not.toContain("做同款");
    });
});

function draftDeps(options: { createError?: unknown; retryErrors?: unknown[]; existing?: string[] } = {}) {
    const calls: string[] = [];
    const existing = new Set(options.existing ?? []);
    const retryErrors = [...(options.retryErrors ?? [])];
    let created = 0;
    const deps: LibTVCanvasDraftDeps = {
        create: async (title) => {
            created += 1;
            const id = `draft-${created}`;
            existing.add(id);
            calls.push(`create:${title}`);
            return options.createError ? { id, syncError: options.createError } : { id };
        },
        retry: async (projectId) => {
            calls.push(`retry:${projectId}`);
            const error = retryErrors.shift();
            if (error) throw error;
        },
        exists: (projectId) => existing.has(projectId),
    };
    return { deps, calls, existing };
}

describe("LibTV work detail dialog", () => {
    test("clicking a card opens the modal instead of routing away", () => {
        const gallery = source("../src/pages/inspiration/index.tsx");
        expect(gallery).toContain('next.set("work", item.templateUuid)');
        expect(gallery).not.toContain("navigate(`/inspiration/${item.templateUuid}`)");
        expect(gallery).toContain("<LibTVWorkDetailDialog templateUuid={activeTemplateUuid}");
        // 关闭弹窗恢复列表上下文，不残留 work 参数。
        expect(gallery).toContain('next.delete("work")');
    });

    test("opening pushes history so Back only closes the modal, closing uses replace so it does not stack", () => {
        const gallery = source("../src/pages/inspiration/index.tsx");
        const open = gallery.slice(gallery.indexOf("const openWork"), gallery.indexOf("const closeWork"));
        const close = gallery.slice(gallery.indexOf("const closeWork"), gallery.indexOf("// 推荐来自已加载的真实列表"));
        // replace:true 会改写列表那条历史，返回键就会离开页面；打开必须压新记录。
        expect(open).toContain("setSearchParams(next);");
        expect(open).not.toContain("replace: true");
        // 关闭则是替换当前记录，多次开关不会堆出一串历史。
        expect(close).toContain("setSearchParams(next, { replace: true });");
        // 弹窗开关完全挂在地址栏上，浏览器返回/前进键都会跟着变。
        expect(gallery).toContain('const activeTemplateUuid = searchParams.get("work") || undefined;');
    });

    test("the dialog uses the repo AppModal flush shell and resets state per work", () => {
        const dialog = source("../src/pages/inspiration/work-detail-dialog.tsx");
        // 沿用仓库弹窗壳（自带 destroyOnHidden），媒体遮罩样式不重复实现 flush 内边距。
        expect(dialog).toContain('import { AppModal } from "@/components/ui/product/app-modal";');
        expect(dialog).toMatch(/<AppModal\s+flush/);
        expect(dialog).not.toContain("padding: 0");
        // key 换作品时重建内容体，展开状态与待同步草稿不串到下一条。
        expect(dialog).toContain("<WorkDetailPane key={templateUuid}");
        expect(dialog).toContain("{templateUuid ? <WorkDetailPane");
        expect(dialog).toContain('className="workspace-modal library-modal libtv-work-detail-dialog"');
    });

    test("the close entry exists in the loading and error phases too", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const body = detail.slice(detail.indexOf("const body = () => {"), detail.indexOf("const stepPrompts ="));
        // 加载中/失败分支都给了关闭入口，弹窗自身的关闭按钮在内容之外，任何阶段都在。
        expect(body).toContain("if (isLoading)");
        expect(body).toContain("if (error || !data)");
        expect(body).toContain("<Button type=\"link\" onClick={onClose}>");
        const dialog = source("../src/pages/inspiration/work-detail-dialog.tsx");
        expect(dialog).toContain('closeIcon={<X className="size-4" />}');
    });

    test("the direct link route still renders the same pane", () => {
        expect(source("../src/router.tsx")).toContain('path: "/inspiration/:templateUuid"');
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        expect(detail).toContain("export default function WorkDetailPage()");
        expect(detail).toContain("export function WorkDetailPane(");
    });

    test("the first screen is the playable video, then one action row, then description and prompt", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const pane = detail.slice(detail.indexOf("export function WorkDetailPane"), detail.indexOf("export default function WorkDetailPage"));
        // 只看渲染部分，避免匹配到事件处理函数里的同名文案。
        const render = pane.slice(pane.indexOf("const body = () => {"));
        const video = render.indexOf("<video ref={mainVideoRef} src={data.work.mediaUrl}");
        for (const anchor of ['查看制作过程', '复制到画布', '一键复刻视频', ">作品描述<", ">提示词<", ">制作流程<"]) {
            expect(render).toContain(anchor);
            expect(video).toBeLessThan(render.indexOf(anchor));
        }
        // 主播放器仍是 LibTV 外链且不自动播放。
        expect(pane).toContain('poster={data.work.coverUrl || undefined}');
        expect(pane).toContain("preload=\"none\"");
        expect(pane).toContain("aspect-video w-full bg-black");
        expect(pane).not.toContain("autoplay");
    });

    test("the process grid opens both media and text steps in the same dialog", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        expect(detail).toContain('const hasMedia = describeLibTVStepMedia(step).kind !== "none"');
        expect(detail).toContain('aria-haspopup="dialog"');
        expect(detail).toContain("onClick={() => openStep(step.id)}");
        const grid = detail.slice(detail.indexOf('aria-label="制作流程步骤"'), detail.indexOf("{warningGroups.length > 0"));
        expect(grid).toContain("{index + 1}");
        expect(grid).toContain("STEP_TYPE_LABEL[step.type]");
        expect(grid).not.toContain("<StepMediaPreview");
        expect(grid).not.toContain("<video");
        expect(grid).not.toContain("<img");
    });

    test("the recommendation column is real data, independent, and never a placeholder grid", () => {
        const dialog = source("../src/pages/inspiration/work-detail-dialog.tsx");
        expect(dialog).toContain("recommended: LibTVGalleryItem[]");
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const aside = detail.slice(detail.indexOf("精选推荐"), detail.indexOf("</aside>"));
        expect(aside).toContain("recommended.map((item)");
        expect(aside).not.toContain("Skeleton");
        expect(aside).not.toContain("占位");
        // 宽屏时左栏自己滚，推荐栏不动；窄屏整块由弹窗体滚。
        expect(detail).toContain("min-w-0 flex-1 lg:h-full lg:overflow-y-auto lg:pr-1");
        expect(detail).toContain("w-full shrink-0 border-t border-border pt-4 lg:w-[280px]");
        expect(aside).not.toContain('aria-label="关闭"');
    });

    test("recommendations exclude the open work, dedupe, and prefer the same tag", () => {
        const same = { tags: [{ id: 3, code: "film", label: "影视" }] };
        const other = { tags: [{ id: 9, code: "anime", label: "动漫" }] };
        const items = [
            galleryItemLike("current", same),
            galleryItemLike("tagged-b", other),
            galleryItemLike("tagged-a", same),
            galleryItemLike("tagged-a", same),
            galleryItemLike("no-title", same, ""),
            galleryItemLike("current", same),
        ];
        expect(pickLibTVRecommendations(items, "current", 6, [3]).map((item) => item.templateUuid)).toEqual(["tagged-a", "tagged-b"]);
        // 同标签优先，但缺口用真实列表补齐；限制生效。
        expect(pickLibTVRecommendations(items, "current", 1, [3]).map((item) => item.templateUuid)).toEqual(["tagged-a"]);
        expect(pickLibTVRecommendations([], "current", 6)).toEqual([]);
    });
});

function galleryItemLike(templateUuid: string, extra: { tags: LibTVGalleryItem["tags"] }, title?: string): LibTVGalleryItem {
    return {
        templateUuid,
        projectUuid: templateUuid,
        title: title ?? `作品 ${templateUuid}`,
        description: "",
        coverUrl: "https://libtv-res.liblib.art/fixture/cover.png",
        mediaUrl: "",
        mediaType: "video",
        authorName: "fixture",
        authorAvatar: "",
        likeCount: 0,
        publishedAt: "2026-09-01T00:00:00Z",
        sourceUrl: "",
        tags: extra.tags,
    };
}

describe("LibTV replication options", () => {
    test("only separate, reusable video steps can be replicated", () => {
        const plan = resolveLibTVReplicationPlan([step(), step({ id: "v1", type: "video" }), step({ id: "v2", type: "video", prompt: "参考 {{Image 1}} 的动作" }), step({ id: "v3", type: "video", referenceNodeIds: ["node-1"] })]);
        expect(plan.kind).toBe("options");
        if (plan.kind === "options") {
            expect(plan.options.map((option) => option.index)).toEqual([1]);
            expect(plan.options[0].state.mode).toBe("video");
        }
    });

    test("a work without a reusable video step falls back to the canvas, never a whole-film claim", () => {
        expect(resolveLibTVReplicationPlan([step()])).toEqual({ kind: "canvas-only", reason: "no-video-step" });
        expect(resolveLibTVReplicationPlan([step({ type: "video", prompt: "  " })])).toEqual({ kind: "canvas-only", reason: "blocked" });
        expect(resolveLibTVReplicationPlan([step({ type: "video", referenceNodeIds: ["node-0"] })])).toEqual({ kind: "canvas-only", reason: "blocked" });
    });

    test("step prompts stay per-step and are never joined into one whole-film prompt", () => {
        const prompts = collectLibTVStepPrompts([step({ id: "a", prompt: " 第一段 " }), step({ id: "b", type: "video", prompt: "第二段" }), step({ id: "c", prompt: "   " })]);
        expect(prompts).toEqual([
            { id: "a", index: 0, title: "主图", type: "image", prompt: "第一段" },
            { id: "b", index: 1, title: "主图", type: "video", prompt: "第二段" },
        ]);
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        expect(detail).toContain("不是整片模板");
        // 只检查提示词渲染区：作者的标签拼接（join(" · ")）在别处，与提示词无关。
        const promptSection = detail.slice(detail.indexOf(">提示词<"), detail.indexOf(">制作流程<"));
        expect(promptSection).toContain("stepPrompts.slice(0, 1).map(renderStepPrompt)");
        expect(promptSection).toContain("stepPrompts.slice(1).map(renderStepPrompt)");
        expect(promptSection).not.toContain(".join(");
    });

    test("replication only prefills the create page and never submits a paid task", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const handler = detail.slice(detail.indexOf("const handleReplicateVideo"), detail.indexOf("const handleMakeSame"));
        expect(handler).toContain("resolveLibTVReplicationPlan(data.steps)");
        expect(handler).not.toContain("navigate(");
        expect(handler).toContain("复制到画布");
        const makeSame = detail.slice(detail.indexOf("const handleMakeSame"), detail.indexOf("const body = () =>"));
        expect(makeSame).toContain("navigate(\"/\", { state: resolution.state })");
        expect(makeSame).not.toContain("submit");
        expect(makeSame).not.toContain("自动付费");
    });
});

describe("LibTV copy-to-canvas remote draft", () => {
    test("navigates only after the remote create succeeds", async () => {
        const { deps, calls } = draftDeps();
        expect(await ensureRemoteLibTVCanvasDraft(undefined, "作品标题", deps)).toEqual({ ok: true, projectId: "draft-1" });
        expect(calls).toEqual(["create:作品标题"]);
    });

    test("a failed cloud create keeps the local draft and blocks the import", async () => {
        const syncError = new Error("网络错误");
        const { deps, calls } = draftDeps({ createError: syncError });
        expect(await ensureRemoteLibTVCanvasDraft(undefined, "LibTV - 模板", deps)).toEqual({ ok: false, projectId: "draft-1", phase: "create", error: syncError });
        expect(calls).toEqual(["create:LibTV - 模板"]);
    });

    test("the next click explicitly retries the same draft before allowing navigation", async () => {
        const retryError = new Error("仍然离线");
        const { deps, calls } = draftDeps({ createError: new Error("网络错误"), retryErrors: [retryError] });
        const first = await ensureRemoteLibTVCanvasDraft(undefined, "LibTV - 模板", deps);
        expect(first.ok).toBe(false);

        const second = await ensureRemoteLibTVCanvasDraft(first.projectId, "LibTV - 模板", deps);
        expect(second).toEqual({ ok: false, projectId: "draft-1", phase: "retry", error: retryError });

        const third = await ensureRemoteLibTVCanvasDraft(second.projectId, "LibTV - 模板", deps);
        expect(third).toEqual({ ok: true, projectId: "draft-1" });
        expect(calls).toEqual(["create:LibTV - 模板", "retry:draft-1", "retry:draft-1"]);
    });

    test("a draft deleted locally is recreated instead of retrying a missing project", async () => {
        const { deps, calls } = draftDeps();
        expect(await ensureRemoteLibTVCanvasDraft("gone", "LibTV - 模板", deps)).toEqual({ ok: true, projectId: "draft-1" });
        expect(calls).toEqual(["create:LibTV - 模板"]);
    });

    test("work detail wires the explicit retry and never navigates on a failed sync", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const handler = detail.slice(detail.indexOf("const handleCopyToCanvas"), detail.indexOf("const handleMakeSame"));
        expect(handler).toContain("retry: (projectId) => saveRemoteUserDataNow(projectId)");
        expect(handler).toContain("formatLocalSavedRemotePending(");
        expect(handler).not.toContain("已保存到云端");
        expect(handler).not.toContain("回滚");
        const failureReturn = handler.indexOf("if (!result.ok)");
        const navigateCall = handler.indexOf("navigate(`/canvas/");
        expect(failureReturn).toBeGreaterThan(-1);
        expect(navigateCall).toBeGreaterThan(failureReturn);
        expect(handler.slice(failureReturn, navigateCall)).toContain("return;");
        expect(handler).not.toContain("mediaUrls");
    });
});

describe("LibTV template import viewport", () => {
    test("only a gallery template imported into an empty canvas reuses fit-to-content after a successful save", () => {
        const project = source("../src/pages/canvas/project.tsx");
        const wrapper = project.slice(project.indexOf("const applyLibTVDialogImport"), project.indexOf("[applyLibTVImport, fitCanvasContent, libTVImportTemplateUuid]"));
        expect(wrapper).toContain("Boolean(libTVImportTemplateUuid) && nodesRef.current.length === 0");
        // 先等保存成功（失败会抛错并撤销），再适应画布。
        expect(wrapper.indexOf("await applyLibTVImport(")).toBeLessThan(wrapper.indexOf("if (fitAfterImport) fitCanvasContent();"));
        expect(project).toContain("onApply={applyLibTVDialogImport}");
        // TapNow 与其他导入不受影响。
        expect(project).toContain("onApply={applyTapNowImport}");
    });
});

describe("LibTV gallery tag containment", () => {
    const tag = (id: number, label: string) => ({ id, code: `code-${id}`, label });

    test("a dozen tags become a handful plus an explicit expand, ordered by real frequency", () => {
        const items = [galleryItemLike("a", { tags: [tag(1, "影视"), tag(2, "动漫")] }), galleryItemLike("b", { tags: [tag(1, "影视")] })];
        const rank = rankLibTVGalleryTags(items, undefined, 2);
        expect(rank.visible.map((item) => item.id)).toEqual([1, 2]);
        expect(rank.hiddenCount).toBe(0);
        // 并列时保持首次出现顺序，不做假分级。
        expect(rankLibTVGalleryTags(items, undefined, 1).visible.map((item) => item.id)).toEqual([1]);
    });

    test("a cold tag selected by hand stays visible even when no work is loaded", () => {
        // 加载中 / 搜索 0 结果 / 请求失败：items 为空，但目录还在。
        const catalog = [tag(7, "活动"), tag(8, "赛事"), tag(9, "国风")];
        const empty = rankLibTVGalleryTags([], 9, 2, catalog);
        expect(empty.visible.map((item) => item.id)).toContain(9);
        expect(empty.visible[0].id).toBe(9);
        // 选中标签占一个名额，目录 3 个、上限 2，其中一个仍在「展开全部」里。
        expect(empty.hiddenCount).toBe(1);
        // 没有目录也没有作品时仍然是空列表，不编造标签。
        expect(rankLibTVGalleryTags([], 9, 8).visible).toEqual([]);
        expect(rankLibTVGalleryTags([], undefined, 8).visible).toEqual([]);
    });

    test("the gallery keeps the catalog across a filter, and can still clear the selection", () => {
        const gallery = source("../src/pages/inspiration/index.tsx");
        // 目录是 state + effect，不在 render 期间往 ref 里写。
        expect(gallery).toContain("const [knownTags, setKnownTags] = useState<LibTVGalleryTag[]>([]);");
        expect(gallery).not.toContain("knownTagsRef");
        expect(gallery).toContain("rankLibTVGalleryTags(items, selectedTagId, 8, knownTags)");
        expect(gallery).toContain("const visibleTags = tagsExpanded ? knownTags : tagRank.visible;");
        // 选中态与清除入口都在，且筛选用的仍是真实 tagId。
        expect(gallery).toContain("checked={selectedTagId === tag.id}");
        expect(gallery).toContain('onChange={() => handleTagClick(tag.id)}');
        expect(gallery).toContain('checked={!selectedTagId}');
        expect(gallery).toContain("onChange={() => handleTagClick(undefined)}");
        expect(gallery).toContain("aria-expanded={tagsExpanded}");
        // 首屏只铺常用的几个，其余按需展开。
        expect(gallery).toContain("{tagsExpanded ? \"收起标签\" : `展开全部 ${knownTags.length} 个标签`}");
    });
});

describe("LibTV work detail liveness", () => {
    test("the request guard only lets the newest call write back", () => {
        const guard = createLatestRequestGuard();
        const first = guard.begin();
        expect(guard.isCurrent(first)).toBe(true);
        const second = guard.begin();
        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
        guard.invalidate();
        expect(guard.isCurrent(second)).toBe(false);
    });

    test("copy-to-canvas re-checks after every await and drops stale results", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const handler = detail.slice(detail.indexOf("const handleCopyToCanvas"), detail.indexOf("const openStep"));
        const guardStart = handler.indexOf("copyGuardRef.current.begin()");
        expect(guardStart).toBeGreaterThan(-1);
        // await 之后都确认仍然是最新这一次（成功路径与异常路径各一处），否则直接丢弃结果。
        const checks = handler.split("copyGuardRef.current.isCurrent(guard)").length - 1;
        expect(checks).toBe(2);
        for (const check of handler.split("copyGuardRef.current.isCurrent(guard)").slice(1)) {
            expect(check).toContain("return;");
        }
        // 导航与提示都在检查之后。
        expect(handler.indexOf("copyGuardRef.current.isCurrent(guard)")).toBeLessThan(handler.indexOf("navigate(`/canvas/"));
        expect(handler.indexOf("copyGuardRef.current.isCurrent(guard)")).toBeLessThan(handler.indexOf("messageApi.warning("));
        expect(handler.indexOf("copyGuardRef.current.isCurrent(guard)")).toBeLessThan(handler.indexOf("messageApi.error("));
    });

    test("closing or switching a work clears the pending draft and invalidates the guard", () => {
        const detail = source("../src/pages/inspiration/work-detail.tsx");
        const effect = detail.slice(detail.indexOf("// 关闭弹窗或切换作品时作废在途的创建请求"), detail.indexOf("const handleCopyToCanvas"));
        expect(effect).toContain("draftProjectIdRef.current = undefined;");
        expect(effect).toContain("copyGuardRef.current.invalidate();");
        expect(effect).toContain("}, [templateUuid]);");
        // 直接链接页也逐条重置：弹窗按 key 重建，路由页靠这个 effect。
        const route = detail.slice(detail.indexOf("export default function WorkDetailPage"));
        expect(route).toContain("<WorkDetailPane templateUuid={templateUuid}");
        expect(route).toContain("pickLibTVRecommendations(data?.items ?? [], templateUuid, 6)");
        expect(route).toContain('queryKey: ["libtv-work-detail-recommend", templateUuid]');
    });

    test("the modal width override is scoped to this one dialog", () => {
        const css = source("../src/styles/globals.css");
        expect(css).toContain(".workspace-modal.library-modal.libtv-work-detail-dialog { width: min(1200px, calc(100vw - 32px)) !important; }");
        // 全局标准/宽弹窗 token 与规则不动。
        expect(css).toContain("--modal-width-standard: 640px;");
        expect(css).toContain("width: min(var(--modal-width-standard), calc(100vw - var(--space-6))) !important;");
        // 覆盖挂在这一个弹窗的类名上，不是把标准宽度整条改掉。
        expect(css).not.toContain(".workspace-modal.library-modal { width:");
        expect(css).not.toContain("--modal-width-standard: 1200px;");
        // 窄屏整块可滚到底，宽屏左栏自己滚。
        expect(css).toContain(".libtv-work-detail-dialog .ant-modal-body { max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior: contain; }");
        expect(css).toContain(".libtv-work-detail-dialog .ant-modal-body { height: min(88dvh, 920px); max-height: none; overflow: hidden; }");
    });
});

describe("LibTV creation page featured works", () => {
    test("精选灵感 reads the same gallery query instead of a copied static list", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        expect(empty).toContain("useInfiniteQuery(libTVGalleryInfiniteQuery({ keyword: \"\" }, getLibTVGallery))");
        // 同一个 queryKey（keyword 空、无 tagId）与灵感广场共享缓存，不复制数据、不转存媒体。
        expect(empty).not.toContain("creationFeaturedWorks");
        expect(empty).not.toContain("inspirationSource");
        expect(empty).not.toContain("creation-inspirations");
        expect(empty).toContain("<img src={item.coverUrl} alt=\"\" loading=\"lazy\" />");
        expect(empty).not.toContain("mediaUrls");
    });

    test("clicking a work opens the same dialog and never fills a prompt or submits", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        expect(empty).toContain("<LibTVWorkDetailDialog");
        expect(empty).toContain("onClick={() => setActiveTemplateUuid(item.templateUuid)}");
        expect(empty).toContain("onClose={() => setActiveTemplateUuid(undefined)}");
        // 点击只开弹窗：不填提示词、不发任务、不改模式。
        const featured = empty.slice(empty.indexOf("export function CreationFeaturedWorks"), empty.indexOf("function CreationFeaturedWorks") === -1 ? undefined : undefined);
        expect(featured).not.toContain("onStartPrompt");
        expect(featured).not.toContain("setPrompt");
        expect(featured).not.toContain("selectMode");
        expect(featured).not.toContain("submit");
        // 创作页对话、模型与积分都留在原地。
        const create = source("../src/pages/create/index.tsx");
        expect(create).toContain("<CreationFeaturedWorks showHeading={false} />");
        expect(create).toContain('userId && userSessionHydrated ? <CreationFeaturedWorks');
        expect(create).toContain('登录后查看画布灵感');
    });

    test("loading, failure and empty are stated honestly without the old footer actions", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        // 失败优先于加载态展示：有错误就说错误，不拿骨架屏装作还在加载。
        expect(empty).toContain("isError && !isFetchNextPageError ? (");
        expect(empty).toContain('message="暂时读不到灵感广场的作品"');
        expect(empty).toContain("onClick={() => void refetch()}");
        expect(empty).toContain(") : isLoading ? (");
        expect(empty).toContain("灵感广场现在还没有公开作品。");
        // 失败时不回落到旧的内置示例冒充「已同步」：卡片只来自真实列表数据。
        expect(empty).not.toContain("creationFeaturedWorks");
        expect(empty).not.toContain("去灵感广场看全部");
        expect(empty).not.toContain("展开更多灵感");
        expect(empty).not.toContain("onOpenGallery");
        expect(empty).not.toContain("个公开作品 · 点开看制作过程，不自动生成");
    });

    test("the end sentinel loads sequential pages in the creation scroll area and stops on errors or an open work", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        expect(empty).toContain("!hasNextPage || isFetching || isError || activeTemplateUuid");
        expect(empty).toContain('typeof IntersectionObserver === "undefined"');
        expect(empty).toContain('root: target.closest(".creation-home-scroll, .creation-empty-workspace")');
        expect(empty).toContain('rootMargin: "0px 0px 240px 0px"');
        expect(empty).toContain("if (requested || !entries.some((entry) => entry.isIntersecting)) return;");
        expect(empty).toContain("requested = true;");
        expect(empty).toContain("fetchNextPage({ cancelRefetch: false })");
        expect(empty).toContain("return () => observer.disconnect();");
        expect(empty).toContain("isFetching, items.length]");
        expect(empty).toContain('ref={loadMoreRef} className="creation-inspiration-load-status" role="status"');
        expect(empty).toContain("下一批灵感加载失败");
        expect(empty).toContain("isFetchNextPageError ? (");
    });

    test("featured ordering gets one new seed per visit and stays stable during pagination", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        expect(empty).toContain("const [shuffleSeed] = useState(() => Math.floor(Math.random() * 0x100000000));");
        expect(empty).toContain("shuffleLibTVGalleryPages(data?.pages ?? [], shuffleSeed)");
        expect(empty).toContain("[data?.pages, shuffleSeed]");
        expect(empty).not.toContain("sort(() => Math.random()");
    });

    test("only a real loaded item can be opened", () => {
        const empty = source("../src/pages/create/creation-workspace-empty.tsx");
        expect(empty).toContain("const [activeTemplateUuid, setActiveTemplateUuid] = useState<string>();");
        expect(empty).toContain("const recommended = useMemo(() => (activeTemplateUuid ? pickLibTVRecommendations(items, activeTemplateUuid, 6) : []), [activeTemplateUuid, items]);");
        expect(empty).toContain("key={item.templateUuid}");
    });
});

describe("LibTV inspiration navigation", () => {
    test("sidebar, title, command palette and route preload all know the inspiration page", () => {
        const sidebar = source("../src/components/layout/workspace-sidebar-nav.tsx");
        const resources = sidebar.slice(sidebar.indexOf('heading: "资源与工具"'), sidebar.indexOf("taskCenterEnabled ? [{ items"));
        expect(resources).toContain('toolItem("inspiration", "/inspiration")');
        expect(resources.indexOf('toolItem("plugins", "/plugins")')).toBeLessThan(resources.indexOf('toolItem("inspiration", "/inspiration")'));
        expect(sidebar).toContain('item.id === "inspiration" ? "灵感"');
        expect(source("../src/components/layout/workspace-top-bar.tsx")).toContain('inspiration: "灵感广场"');
        expect(source("../src/components/layout/workspace-command-palette.tsx")).toContain('toolEntry("inspiration", "/inspiration")');
        const modules = source("../src/lib/workspace-route-modules.ts");
        expect(modules).toContain('inspiration: () => import("@/pages/inspiration")');
        expect(source("../src/router.tsx")).toContain("lazy(loadInspirationPage)");
        expect(source("../src/constant/navigation-tools.ts")).toContain("inspiration");
    });
});
