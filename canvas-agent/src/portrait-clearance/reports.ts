import {
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from "docx";
import sharp from "sharp";

import type {
    PortraitClearanceResult,
    PortraitFeatureKey,
    PortraitImageQuality,
    PortraitLocalPrecheck,
    PortraitPairResult,
    PortraitRiskLevel,
    PortraitVisionComparison,
} from "./contracts.js";

const MAX_EMBEDDED_IMAGE_BYTES = 1_500_000;
const MAX_TOTAL_EMBEDDED_IMAGE_BYTES = 12 * 1024 * 1024;
const HTML_REPORT_VERSION = "2";
const DISCLAIMER = "本结果仅表示当前检索范围内的可识别性排查，不是身份确认、法律结论或司法鉴定。";

const RISK_ORDER: PortraitRiskLevel[] = ["high", "medium", "low_to_medium", "low", "unable_to_determine"];
const FEATURE_LABELS: Record<PortraitFeatureKey, string> = {
    face_shape: "脸型与下颌线",
    facial_layout: "五官整体布局",
    eyes_brows: "眼型与眉形",
    nose_mouth: "鼻型与嘴型",
    hair_hairline: "发型与发际线",
    distinctive_features: "标志性特征",
};
const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as PortraitFeatureKey[];

export type PortraitReportImage = {
    id: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    bytes: Uint8Array;
};

type ImageBudget = {
    remaining: number;
    embeddedIds: Set<string>;
};

type ReportSummary = {
    riskCounts: Record<PortraitRiskLevel, number>;
    successCount: number;
    partialCount: number;
    failedCount: number;
};

export async function buildPortraitReports(result: PortraitClearanceResult, images: readonly PortraitReportImage[] = []) {
    const markdown = buildMarkdown(result);
    const html = buildHtml(result, await optimizeHtmlImages(images));
    const docx = await buildDocx(result, images);
    return { markdown, html, docx };
}

function buildMarkdown(result: PortraitClearanceResult) {
    const summary = summarizeResult(result);
    const lines = [
        "# 肖像权可识别性撞脸排查报告",
        "",
        "## 一、检测结论",
        "",
        `查询图：${result.queryImageId}`,
        `排查模式：${modeLabel(result.mode)}`,
        `候选数：${result.candidateCount}`,
        `已完成分析：${result.comparedCount}`,
        `处理状态：已完成 ${summary.successCount} 项；部分完成 ${summary.partialCount} 项；失败/跳过 ${summary.failedCount} 项`,
        `综合风险等级：**${riskLabel(result.highestRisk)}**`,
        `创建时间：${result.createdAt}`,
        `完成时间：${result.completedAt || "尚未完成全部视觉模型分析"}`,
        "",
        `> ${DISCLAIMER}`,
        "",
        "风险分布：",
        ...RISK_ORDER.filter((risk) => summary.riskCounts[risk] > 0).map((risk) => `- ${riskLabel(risk)}：${summary.riskCounts[risk]} 个`),
        "",
        `**综合结论：** ${verdict(result.highestRisk)}`,
    ];

    const unableReasons = collectUnableReasons(result);
    if (unableReasons.length) lines.push("", "无法可靠判断的主要原因：", ...unableReasons.map((item) => `- ${markdownInline(item)}`));

    lines.push("", "## 二、详细比对结果", "");
    lines.push("| # | 比对图 | 来源 | 状态 | 分析路径 | 风险等级 | 整体相似度 | 本地指标说明 | 主要依据 |");
    lines.push("|---:|---|---|---|---|---|---:|---|---|");
    for (const pair of orderedPairs(result)) {
        const candidate = candidateForPair(result, pair);
        const basis = visionBasis(pair).slice(0, 2).join("；") || "无";
        lines.push([
            candidate?.originalRank ?? "-",
            markdownInline(candidate?.title || pair.comparisonImageId),
            sourceLabel(pair.source),
            statusLabel(pair.status),
            analysisPathLabel(pair.analysisPath),
            riskLabel(pair.riskLevel),
            pair.overallSimilarity === undefined ? "-" : pair.overallSimilarity.toFixed(2),
            markdownInline(localMetricSummary(pair)),
            markdownInline(basis).slice(0, 120),
        ].join(" | "));
    }

    for (const pair of orderedPairs(result)) {
        const candidate = candidateForPair(result, pair);
        const vision = pair.visionComparison;
        lines.push("", `### #${candidate?.originalRank ?? "-"} ${markdownInline(candidate?.title || pair.comparisonImageId)} — ${riskLabel(pair.riskLevel)}`, "");
        lines.push(`- 来源：${sourceLabel(pair.source)}`);
        lines.push(`- 状态：${statusLabel(pair.status)}`);
        lines.push(`- 分析路径：${analysisPathLabel(pair.analysisPath)}`);
        if (pair.overallSimilarity !== undefined) lines.push(`- 整体相似度：${pair.overallSimilarity.toFixed(4)}`);
        if (candidate?.sourceDomain) lines.push(`- 来源域名：${markdownInline(candidate.sourceDomain)}`);
        if (candidate?.sourcePageUrl && safeUrl(candidate.sourcePageUrl)) lines.push(`- 来源页面：[打开来源页面](${safeUrl(candidate.sourcePageUrl)})`);
        if (pair.error) lines.push(`- 处理说明：${markdownInline(pair.error.message)}（${markdownInline(pair.error.code)}）`);

        lines.push("", "#### 本地预检", "", ...localMetricLines(pair.localPrecheck, pair.analysisPath).map((item) => `- ${markdownInline(item)}`));
        if (vision) {
            lines.push("", "#### 多模态面部特征分析", "");
            lines.push(`- 图像类型：A=${imageTypeLabel(vision.imageAType)}；B=${imageTypeLabel(vision.imageBType)}`);
            lines.push(`- 模型状态：${vision.status === "success" ? "完成" : "无法可靠判断"}`);
            lines.push(`- 模型风险：${riskLabel(vision.riskLevel)}`);
            lines.push(`- 人工复核：${vision.manualReviewRecommended ? "建议" : "未特别标记"}`);
            lines.push("", "| 特征维度 | 相似度 | 分析说明 |", "|---|---|---|");
            for (const key of FEATURE_KEYS) {
                const feature = vision.featureComparison[key];
                lines.push(`| ${FEATURE_LABELS[key]} | ${featureSimilarityLabel(feature.similarity)} | ${markdownInline(feature.note)} |`);
            }
            if (vision.insightfaceFusionNote) lines.push("", `- InsightFace 融合说明：${markdownInline(vision.insightfaceFusionNote)}`);
            if (vision.basis.length) lines.push("", "主要依据：", ...vision.basis.map((item) => `- ${markdownInline(item)}`));
            if (vision.modificationSuggestions.length) lines.push("", "修改建议：", ...vision.modificationSuggestions.map((item) => `- ${markdownInline(item)}`));
            if (vision.limitations.length) lines.push("", "模型局限：", ...vision.limitations.map((item) => `- ${markdownInline(item)}`));
        } else {
            lines.push("", "主要依据：", ...pair.basis.map((item) => `- ${markdownInline(item)}`));
        }
        if (pair.limitations.length) lines.push("", "本项限制：", ...pair.limitations.map((item) => `- ${markdownInline(item)}`));
    }

    lines.push("", "## 三、限制说明", "", ...globalLimitations(result).map((item) => `- ${markdownInline(item)}`));
    return lines.join("\n");
}

function buildHtml(result: PortraitClearanceResult, images: readonly PortraitReportImage[]) {
    const imageMap = new Map(images.map((image) => [image.id, image]));
    const budget: ImageBudget = { remaining: MAX_TOTAL_EMBEDDED_IMAGE_BYTES, embeddedIds: new Set() };
    const queryImage = imageMap.get(result.queryImageId);
    const queryImageHtml = imageFrame(queryImage, "查询图", budget, result.queryImageId);
    const summary = summarizeResult(result);
    const riskBadges = RISK_ORDER.filter((risk) => summary.riskCounts[risk] > 0)
        .map((risk) => `<span class="badge ${risk}">${riskLabel(risk)}：${summary.riskCounts[risk]} 个</span>`)
        .join("");
    const unableReasons = collectUnableReasons(result);
    const unableReasonsHtml = unableReasons.length
        ? `<div class="verdict-reasons"><strong>无法可靠判断的主要原因：</strong>${htmlList(unableReasons)}</div>`
        : "";

    const pairHtml = orderedPairs(result).map((pair) => {
        const candidate = candidateForPair(result, pair);
        const title = candidate?.title || pair.comparisonImageId;
        const candidateImage = imageMap.get(pair.comparisonImageId);
        const vision = pair.visionComparison;
        const limitations = unique([...pair.limitations, ...(vision?.limitations || [])]);
        const sourceLink = candidate?.sourcePageUrl && safeUrl(candidate.sourcePageUrl)
            ? `<a rel="noreferrer" target="_blank" href="${escapeHtml(safeUrl(candidate.sourcePageUrl) as string)}">打开来源页面</a>`
            : "";
        const targetWarning = pair.localPrecheck.facesA > 1 || pair.localPrecheck.facesB > 1
            ? `<div class="target-warning"><strong>目标对象提示：</strong>检测到多张人脸，当前结果无法确认具体比对目标。建议先裁剪到单一目标人脸，或明确指定目标人物后重新检测。</div>`
            : "";
        const errorHtml = pair.error
            ? `<div class="error-note"><strong>处理说明：</strong>${escapeHtml(pair.error.message)}<span class="error-code">${escapeHtml(pair.error.code)}</span></div>`
            : "";
        const visionHtml = vision ? `<div class="vision-block">
            <h4>多模态面部特征分析</h4>
            <div class="detail-grid"><span><strong>图像类型：</strong>A-${escapeHtml(imageTypeLabel(vision.imageAType))} / B-${escapeHtml(imageTypeLabel(vision.imageBType))}</span><span><strong>模型状态：</strong>${escapeHtml(vision.status === "success" ? "完成" : "无法可靠判断")}</span><span><strong>模型风险：</strong>${escapeHtml(riskLabel(vision.riskLevel))}</span><span><strong>人工复核：</strong>${vision.manualReviewRecommended ? "建议" : "未特别标记"}</span></div>
            ${featureTableHtml(vision)}
            ${vision.insightfaceFusionNote ? `<div class="fusion-note"><strong>InsightFace 融合说明：</strong>${escapeHtml(vision.insightfaceFusionNote)}</div>` : ""}
            ${vision.basis.length ? `<div class="subsection"><strong>主要依据</strong>${htmlList(vision.basis)}</div>` : ""}
            ${vision.modificationSuggestions.length ? `<div class="subsection suggestion-note"><strong>修改建议</strong>${htmlList(vision.modificationSuggestions)}</div>` : ""}
        </div>` : `<div class="subsection"><strong>主要依据</strong>${htmlList(pair.basis, "无")}</div>`;

        return `<article class="comp-card ${pair.status === "failed" ? "is-failed" : ""}">
            <div class="comp-header"><span class="comp-title">#${escapeHtml(String(candidate?.originalRank ?? "-"))} — ${escapeHtml(title.slice(0, 100))}</span><span class="badge ${pair.riskLevel}">${escapeHtml(riskLabel(pair.riskLevel))}</span><span class="status-badge ${pair.status}">${escapeHtml(statusLabel(pair.status))}</span></div>
            <div class="comp-images"><div class="img-box">${queryImageHtml}<div class="img-label">查询图</div></div><div class="img-box">${imageFrame(candidateImage, title, budget, pair.comparisonImageId)}<div class="img-label">候选图：${escapeHtml(title)}</div></div></div>
            <div class="detail-grid"><span><strong>来源：</strong>${escapeHtml(sourceLabel(pair.source))}</span><span><strong>分析路径：</strong>${escapeHtml(analysisPathLabel(pair.analysisPath))}</span><span><strong>整体相似度：</strong>${pair.overallSimilarity === undefined ? "-" : pair.overallSimilarity.toFixed(4)}</span><span><strong>本地预检：</strong>${escapeHtml(localMetricSummary(pair))}</span></div>
            ${targetWarning}${errorHtml}
            <div class="precheck-block"><h4>本地预检明细</h4>${precheckTableHtml(pair.localPrecheck, pair.analysisPath)}</div>
            ${visionHtml}
            ${limitations.length ? `<div class="subsection limitation-note"><strong>限制与人工复核</strong>${htmlList(limitations)}</div>` : ""}
            ${sourceLink ? `<div class="source-link">${sourceLink}</div>` : ""}
        </article>`;
    }).join("");

    const metaRows = [
        ["任务", result.taskId],
        ["排查模式", modeLabel(result.mode)],
        ["候选数", String(result.candidateCount)],
        ["已完成分析", String(result.comparedCount)],
        ["处理状态", `完成 ${summary.successCount} / 部分 ${summary.partialCount} / 失败或跳过 ${summary.failedCount}`],
        ["创建时间", result.createdAt],
        ["完成时间", result.completedAt || "尚未完成全部视觉模型分析"],
    ];
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>肖像权可识别性撞脸排查报告</title><style>${htmlCss()}</style></head><body data-report-version="${HTML_REPORT_VERSION}"><main class="container">
        <header class="report-header"><h1>肖像权可识别性撞脸排查报告</h1><p>本地预检 + 项目视觉模型双路径分析 · 结果经本机结构校验</p></header>
        <div class="notice">${escapeHtml(DISCLAIMER)}</div>
        <section class="summary-card"><div class="query-img">${queryImageHtml}<div class="label">查询图</div></div><div class="summary-info"><h2>综合风险等级：<span class="badge ${result.highestRisk}">${escapeHtml(riskLabel(result.highestRisk))}</span></h2><div class="risk-dist">${riskBadges}</div><div class="verdict ${result.highestRisk}">${escapeHtml(verdict(result.highestRisk))}</div>${unableReasonsHtml}</div></section>
        <section class="section"><h2>检测概览</h2><dl class="meta">${metaRows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></section>
        <section class="section"><h2>详细比对结果</h2>${pairHtml || "<p>当前没有可交付的比对结果。</p>"}</section>
        <section class="section"><h2>限制说明</h2>${htmlList(globalLimitations(result))}</section>
    </main></body></html>`;
}

async function buildDocx(result: PortraitClearanceResult, images: readonly PortraitReportImage[]) {
    const imageMap = new Map(images.map((image) => [image.id, image]));
    const summary = summarizeResult(result);
    const children: Array<Paragraph | Table> = [
        new Paragraph({ text: "肖像权可识别性撞脸排查报告", heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: DISCLAIMER, bold: true })] }),
        reportTable([
            ["任务", result.taskId],
            ["排查模式", modeLabel(result.mode)],
            ["候选数", String(result.candidateCount)],
            ["已完成分析", String(result.comparedCount)],
            ["处理状态", `完成 ${summary.successCount} 项；部分完成 ${summary.partialCount} 项；失败/跳过 ${summary.failedCount} 项`],
            ["创建时间", result.createdAt],
            ["完成时间", result.completedAt || "尚未完成全部视觉模型分析"],
        ]),
        new Paragraph({ text: "一、检测结论", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: "综合风险等级：", bold: true }), new TextRun({ text: riskLabel(result.highestRisk), bold: true, color: riskColor(result.highestRisk) })] }),
        new Paragraph(`风险分布：${RISK_ORDER.filter((risk) => summary.riskCounts[risk] > 0).map((risk) => `${riskLabel(risk)} ${summary.riskCounts[risk]} 个`).join("；") || "无"}`),
        new Paragraph(verdict(result.highestRisk)),
        ...collectUnableReasons(result).map((item) => new Paragraph({ text: `无法判断原因：${item}`, bullet: { level: 0 } })),
        new Paragraph({ text: "查询图", heading: HeadingLevel.HEADING_1 }),
    ];
    const budget: ImageBudget = { remaining: MAX_TOTAL_EMBEDDED_IMAGE_BYTES, embeddedIds: new Set() };
    const queryImage = imageMap.get(result.queryImageId);
    if (queryImage) children.push(await docxImageParagraph(queryImage, "查询图", budget));

    children.push(new Paragraph({ text: "二、详细比对结果", heading: HeadingLevel.HEADING_1 }));
    for (const pair of orderedPairs(result)) {
        const candidate = candidateForPair(result, pair);
        const title = candidate?.title || pair.comparisonImageId;
        const candidateImage = imageMap.get(pair.comparisonImageId);
        const vision = pair.visionComparison;
        const limitations = unique([...pair.limitations, ...(vision?.limitations || [])]);
        children.push(new Paragraph({ text: `#${candidate?.originalRank ?? "-"} ${title} — ${riskLabel(pair.riskLevel)}`, heading: HeadingLevel.HEADING_2 }));
        if (candidateImage) children.push(await docxImageParagraph(candidateImage, "候选图", budget));
        children.push(reportTable([
            ["来源", sourceLabel(pair.source)],
            ["状态", statusLabel(pair.status)],
            ["分析路径", analysisPathLabel(pair.analysisPath)],
            ["整体相似度", pair.overallSimilarity === undefined ? "-" : pair.overallSimilarity.toFixed(4)],
            ["本地指标", localMetricSummary(pair)],
        ]));
        if (pair.error) children.push(new Paragraph({ children: [new TextRun({ text: `处理说明：${pair.error.message}（${pair.error.code}）`, bold: true })] }));
        children.push(new Paragraph({ text: "本地预检明细", heading: HeadingLevel.HEADING_3 }), reportTable(localMetricRows(pair.localPrecheck, pair.analysisPath)));
        if (pair.localPrecheck.facesA > 1 || pair.localPrecheck.facesB > 1) children.push(new Paragraph("目标对象提示：检测到多张人脸，当前结果无法确认具体比对目标。建议先裁剪到单一目标人脸后重新检测。"));
        if (vision) {
            children.push(new Paragraph({ text: "多模态面部特征分析", heading: HeadingLevel.HEADING_3 }));
            children.push(reportTable([
                ["图像类型", `A-${imageTypeLabel(vision.imageAType)} / B-${imageTypeLabel(vision.imageBType)}`],
                ["模型状态", vision.status === "success" ? "完成" : "无法可靠判断"],
                ["模型风险", riskLabel(vision.riskLevel)],
                ["人工复核", vision.manualReviewRecommended ? "建议" : "未特别标记"],
            ]));
            children.push(featureTableDocx(vision));
            if (vision.insightfaceFusionNote) children.push(new Paragraph(`InsightFace 融合说明：${vision.insightfaceFusionNote}`));
            if (vision.basis.length) children.push(new Paragraph({ text: "主要依据", heading: HeadingLevel.HEADING_4 }), ...vision.basis.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
            if (vision.modificationSuggestions.length) children.push(new Paragraph({ text: "修改建议", heading: HeadingLevel.HEADING_4 }), ...vision.modificationSuggestions.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
        } else {
            children.push(new Paragraph({ text: "主要依据", heading: HeadingLevel.HEADING_3 }), ...pair.basis.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
        }
        if (limitations.length) children.push(new Paragraph({ text: "限制与人工复核", heading: HeadingLevel.HEADING_3 }), ...limitations.map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
        if (candidate?.sourcePageUrl && safeUrl(candidate.sourcePageUrl)) children.push(new Paragraph(`来源页面：${safeUrl(candidate.sourcePageUrl)}`));
    }

    children.push(new Paragraph({ text: "三、限制说明", heading: HeadingLevel.HEADING_1 }), ...globalLimitations(result).map((item) => new Paragraph({ text: item, bullet: { level: 0 } })));
    const document = new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 } } }, children }] });
    return new Uint8Array(await Packer.toBuffer(document));
}

function summarizeResult(result: PortraitClearanceResult): ReportSummary {
    const riskCounts = Object.fromEntries(RISK_ORDER.map((risk) => [risk, result.riskCounts[risk] ?? 0])) as Record<PortraitRiskLevel, number>;
    return {
        riskCounts,
        successCount: result.pairs.filter((pair) => pair.status === "success").length,
        partialCount: result.pairs.filter((pair) => pair.status === "partial").length,
        failedCount: result.pairs.filter((pair) => pair.status === "failed").length,
    };
}

function orderedPairs(result: PortraitClearanceResult) {
    return [...result.pairs].sort((left, right) => riskRank(right.riskLevel) - riskRank(left.riskLevel) || (right.overallSimilarity ?? 0) - (left.overallSimilarity ?? 0) || (candidateForPair(result, left)?.originalRank ?? 0) - (candidateForPair(result, right)?.originalRank ?? 0));
}

function candidateForPair(result: PortraitClearanceResult, pair: PortraitPairResult) {
    return result.candidates.find((candidate) => candidate.resultId === pair.id || candidate.id === pair.candidateId);
}

function localMetricRows(precheck: PortraitLocalPrecheck, analysisPath: PortraitPairResult["analysisPath"]): Array<[string, string]> {
    const rows: Array<[string, string]> = [
        ["人脸数", `A=${precheck.facesA} / B=${precheck.facesB}`],
        ["画质等级", `A-${qualityLabel(precheck.qualityA.grade)}（${precheck.qualityA.width}×${precheck.qualityA.height}） / B-${qualityLabel(precheck.qualityB.grade)}（${precheck.qualityB.width}×${precheck.qualityB.height}）`],
        ["SSIM", precheck.ssim.toFixed(4)],
        ["颜色直方图相关性", precheck.colorHistogramCorrelation.toFixed(4)],
        ["可提取人脸 embedding", precheck.canExtractEmbedding ? "是" : "否"],
    ];
    if (precheck.faceSimilarity !== undefined && analysisPath !== "B") rows.splice(2, 0, ["InsightFace 余弦相似度", precheck.faceSimilarity.toFixed(4)]);
    if (analysisPath === "B") rows.splice(2, 0, ["本地 embedding 说明", "风格化路径不采用本地人脸 embedding 作为主要判断依据"]);
    return rows;
}

function localMetricLines(precheck: PortraitLocalPrecheck, analysisPath: PortraitPairResult["analysisPath"]) {
    return localMetricRows(precheck, analysisPath).map(([key, value]) => `${key}：${value}`).concat(precheck.reliabilityIssues.length ? [`可靠性问题：${precheck.reliabilityIssues.join("；")}`] : []);
}

function localMetricSummary(pair: PortraitPairResult) {
    const precheck = pair.localPrecheck;
    if (precheck.facesA > 1 || precheck.facesB > 1) return "检测到多张人脸，需人工指定目标";
    if (pair.analysisPath === "B") return "风格化路径，不采用本地 embedding";
    if (precheck.faceSimilarity !== undefined) return `InsightFace 余弦相似度 ${precheck.faceSimilarity.toFixed(4)}`;
    return "未提取到可比对的人脸特征";
}

function precheckTableHtml(precheck: PortraitLocalPrecheck, analysisPath: PortraitPairResult["analysisPath"]) {
    return definitionTableHtml(localMetricRows(precheck, analysisPath).concat(precheck.reliabilityIssues.length ? [["可靠性问题", precheck.reliabilityIssues.join("；")]] : []));
}

function featureTableHtml(vision: PortraitVisionComparison) {
    const rows = FEATURE_KEYS.map((key) => {
        const feature = vision.featureComparison[key];
        return `<tr><td>${escapeHtml(FEATURE_LABELS[key])}</td><td><span class="feature-badge ${feature.similarity}">${escapeHtml(featureSimilarityLabel(feature.similarity))}</span></td><td>${escapeHtml(feature.note || "-")}</td></tr>`;
    }).join("");
    return `<table class="feature-table"><thead><tr><th>特征维度</th><th>相似度</th><th>分析说明</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function featureTableDocx(vision: PortraitVisionComparison) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph("特征维度")] }), new TableCell({ children: [new Paragraph("相似度")] }), new TableCell({ children: [new Paragraph("分析说明")] })] }),
            ...FEATURE_KEYS.map((key) => {
                const feature = vision.featureComparison[key];
                return new TableRow({ children: [new TableCell({ children: [new Paragraph(FEATURE_LABELS[key])] }), new TableCell({ children: [new Paragraph(featureSimilarityLabel(feature.similarity))] }), new TableCell({ children: [new Paragraph(feature.note || "-")] })] });
            }),
        ],
    });
}

function reportTable(rows: Array<[string, string]>) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(([label, value]) => new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }), new TableCell({ children: [new Paragraph(value)] })] })),
    });
}

async function docxImageParagraph(image: PortraitReportImage, alt: string, budget: ImageBudget) {
    const bytes = await docxImageBytes(image, budget);
    if (!bytes) return new Paragraph(`（${alt}未内嵌：图片过大或报告容量已达到上限）`);
    return new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width: 320, height: 240 }, type: image.mimeType === "image/jpeg" ? "jpg" : "png" }), new TextRun({ text: `\n${alt}`, break: 1 })] });
}

async function docxImageBytes(image: PortraitReportImage, budget: ImageBudget) {
    if (image.bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES || image.bytes.byteLength > budget.remaining) return undefined;
    if (budget.embeddedIds.has(image.id)) return undefined;
    budget.remaining -= image.bytes.byteLength;
    budget.embeddedIds.add(image.id);
    return image.mimeType === "image/webp" ? await sharp(image.bytes).png().toBuffer() : Buffer.from(image.bytes);
}

function imageFrame(image: PortraitReportImage | undefined, alt: string, budget: ImageBudget, id: string) {
    if (!image) return `<div class="image-placeholder">${escapeHtml(alt)}<br><small>图片未随报告内嵌</small></div>`;
    if (image.bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES || (!budget.embeddedIds.has(id) && image.bytes.byteLength > budget.remaining)) return `<div class="image-placeholder">${escapeHtml(alt)}<br><small>图片过大，未内嵌</small></div>`;
    if (!budget.embeddedIds.has(id)) {
        budget.remaining -= image.bytes.byteLength;
        budget.embeddedIds.add(id);
    }
    return `<img loading="lazy" alt="${escapeHtml(alt)}" src="data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}">`;
}

async function optimizeHtmlImages(images: readonly PortraitReportImage[]) {
    return Promise.all(images.map(async (image) => {
        try {
            const source = sharp(image.bytes).rotate().flatten({ background: "#ffffff" });
            for (const width of [1280, 1024, 768, 640]) {
                for (const quality of [78, 66, 54]) {
                    const bytes = await source.clone().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).jpeg({ quality, progressive: true }).toBuffer();
                    if (bytes.byteLength <= MAX_EMBEDDED_IMAGE_BYTES) return { ...image, mimeType: "image/jpeg" as const, bytes };
                }
            }
            const bytes = await source.clone().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 42, progressive: true }).toBuffer();
            return { ...image, mimeType: "image/jpeg" as const, bytes };
        } catch {
            return image;
        }
    }));
}

function definitionTableHtml(rows: Array<[string, string]>) {
    return `<dl class="definition-table">${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}

function htmlList(items: string[], emptyText = "无") {
    return `<ul>${(items.length ? items : [emptyText]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function globalLimitations(result: PortraitClearanceResult) {
    const limitations = [...result.limitations, "比对结果可能受图片质量、角度、遮挡、风格化程度和候选图来源影响。"];
    if (result.pairs.some((pair) => pair.analysisPath === "B")) limitations.push("风格化图像场景不采用本地人脸 embedding 作为主要判断依据。", "风格化图像的结果应结合视觉特征和人工复核，不应单独作为身份结论。");
    if (result.pairs.some((pair) => pair.localPrecheck.facesA > 1 || pair.localPrecheck.facesB > 1)) limitations.push("多张人脸场景需要先裁剪到单一目标人脸，或明确指定目标人物后重新检测。");
    if (result.pairs.some((pair) => pair.status === "failed")) limitations.push("部分候选未完成比对，已在对应条目中标记为失败/跳过；一个候选失败不会代表其他候选的结果。");
    limitations.push("本结果不能替代司法鉴定、律师意见或法院判断。");
    return unique(limitations);
}

function collectUnableReasons(result: PortraitClearanceResult, limit = 6) {
    const reasons: string[] = [];
    for (const pair of result.pairs) {
        if (pair.riskLevel !== "unable_to_determine") continue;
        for (const item of [...pair.localPrecheck.reliabilityIssues, ...pair.limitations, ...(pair.visionComparison?.limitations || []), ...(pair.error ? [pair.error.message] : []), ...pair.basis]) {
            if (item && !reasons.includes(item)) reasons.push(item);
            if (reasons.length >= limit) return reasons;
        }
    }
    return reasons;
}

function visionBasis(pair: PortraitPairResult) {
    return pair.visionComparison?.basis.length ? pair.visionComparison.basis : pair.basis;
}

function verdict(level: PortraitRiskLevel) {
    return ({
        high: "存在较高撞脸风险，建议人工复核。本结果不能替代司法鉴定、律师意见或法院判断。",
        medium: "存在一定撞脸风险，建议人工复核。本结果不能替代司法鉴定、律师意见或法院判断。",
        low_to_medium: "在比对范围内存在局部相似，公开传播或商业使用前建议人工确认。",
        low: "在当前比对范围内未发现高相似候选对象。但这不代表不存在其他肖像权风险。",
        unable_to_determine: "部分或全部比对对象无法可靠判断，建议人工复核。",
    } as Record<PortraitRiskLevel, string>)[level];
}

function modeLabel(mode: PortraitClearanceResult["mode"]) {
    return mode === "direct-compare" ? "直接比对" : "网络排查";
}

function sourceLabel(source: PortraitPairResult["source"]) {
    return ({ "connected-reference": "已连接参考图", "connected-candidate": "已连接候选图", baidu: "百度识图候选" } as Record<PortraitPairResult["source"], string>)[source];
}

function statusLabel(status: PortraitPairResult["status"]) {
    return ({ success: "完成", partial: "部分完成", failed: "失败/跳过" } as Record<PortraitPairResult["status"], string>)[status];
}

function analysisPathLabel(path: PortraitPairResult["analysisPath"]) {
    return path === "A" ? "Path A（写实图/本地特征融合）" : path === "B" ? "Path B（风格化视觉分析）" : "无法形成可靠路径";
}

function imageTypeLabel(value: PortraitVisionComparison["imageAType"]) {
    return value === "realistic" ? "写实" : "风格化";
}

function qualityLabel(value: PortraitImageQuality["grade"]) {
    return ({ good: "良好", usable: "可用", poor: "较差" } as Record<PortraitImageQuality["grade"], string>)[value];
}

function featureSimilarityLabel(value: PortraitVisionComparison["featureComparison"][PortraitFeatureKey]["similarity"]) {
    return ({ high: "高度相似", medium: "中等相似", low: "低度相似", none: "无明显相似" } as Record<typeof value, string>)[value];
}

function riskLabel(value: PortraitRiskLevel) {
    return ({ high: "高", medium: "中", low_to_medium: "中低", low: "低", unable_to_determine: "无法判断" } as Record<PortraitRiskLevel, string>)[value];
}

function riskRank(value: PortraitRiskLevel) {
    return RISK_ORDER.length - RISK_ORDER.indexOf(value);
}

function riskColor(value: PortraitRiskLevel) {
    return ({ high: "C62828", medium: "B26A00", low_to_medium: "9A7800", low: "2E7D32", unable_to_determine: "78716C" } as Record<PortraitRiskLevel, string>)[value];
}

function unique(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function markdownInline(value: string) {
    return value.replace(/[|\r\n]/g, " ").replace(/`/g, "'");
}

function safeUrl(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function htmlCss() {
    return `:root{--text:#20242a;--muted:#626b75;--border:#d9dee5;--panel:#fff;--surface:#f5f7f9;--high:#c62828;--high-bg:#fff1f0;--medium:#b26a00;--medium-bg:#fff7e6;--lowmid:#9a7800;--lowmid-bg:#fffbe6;--low:#2e7d32;--low-bg:#f0f9f1;--unable:#78716c;--unable-bg:#f5f5f4}*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:var(--text);font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.6}.container{max-width:1120px;margin:0 auto;padding:32px 22px 56px}.report-header{margin-bottom:18px}.report-header h1{margin:0 0 4px;font-size:30px;letter-spacing:.01em}.report-header p{margin:0;color:var(--muted);font-size:14px}.notice{padding:12px 16px;margin:16px 0;background:#fffbe6;border:1px solid #ffe58f;border-left:4px solid #d39b00;border-radius:8px;color:#6b5a16}.summary-card{display:flex;gap:24px;padding:20px;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 3px 12px #1f29370b}.query-img{width:230px;flex:0 0 230px}.query-img img,.img-box img{display:block;width:100%;height:270px;object-fit:contain;background:var(--surface);border:1px solid var(--border);border-radius:8px}.query-img .label,.img-label{text-align:center;color:var(--muted);font-size:12px;margin-top:5px}.image-placeholder{display:grid;place-items:center;align-content:center;min-height:180px;padding:20px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--border);border-radius:8px}.image-placeholder small{font-size:11px}.summary-info{min-width:0;flex:1}.summary-info h2{margin:2px 0 12px;font-size:21px}.badge,.status-badge,.feature-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}.badge.high,.feature-badge.high{background:var(--high-bg);color:var(--high)}.badge.medium,.feature-badge.medium{background:var(--medium-bg);color:var(--medium)}.badge.low_to_medium,.feature-badge.low{background:var(--lowmid-bg);color:var(--lowmid)}.badge.low{background:var(--low-bg);color:var(--low)}.badge.unable_to_determine,.feature-badge.none{background:var(--unable-bg);color:var(--unable)}.risk-dist{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.verdict{padding:12px 14px;border-radius:8px;background:var(--surface);color:#444}.verdict.high,.verdict.medium{background:var(--high-bg);color:#6b1d1d}.verdict.low_to_medium{background:var(--lowmid-bg);color:#665400}.verdict.low{background:var(--low-bg);color:#245b29}.verdict-reasons{margin-top:12px;color:var(--muted);font-size:13px}.meta,.definition-table{display:grid;grid-template-columns:170px 1fr;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden}.meta dt,.meta dd,.definition-table dt,.definition-table dd{margin:0;padding:8px 11px;border-bottom:1px solid var(--border);font-size:13px}.meta dt,.definition-table dt{font-weight:700;color:var(--muted);background:var(--surface)}.meta dd,.definition-table dd{background:#fff}.meta dt:last-of-type,.meta dd:last-of-type,.definition-table dt:last-of-type,.definition-table dd:last-of-type{border-bottom:0}.section{margin-top:24px;padding:22px;background:var(--panel);border:1px solid var(--border);border-radius:12px}.section>h2{margin:0 0 14px;font-size:20px}.comp-card{margin-top:18px;padding:18px;border:1px solid var(--border);border-radius:10px;background:#fff}.comp-card.is-failed{border-color:#e2c08b;background:#fffdf6}.comp-header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}.comp-title{font-size:17px;font-weight:750;margin-right:auto}.status-badge.success{background:#edf7ee;color:#2e7d32}.status-badge.partial{background:#fff7e6;color:#9a6200}.status-badge.failed{background:#fff1f0;color:#b42318}.comp-images{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}.detail-grid{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--muted);font-size:13px}.detail-grid strong{color:var(--text)}.target-warning,.error-note,.fusion-note,.suggestion-note,.limitation-note{margin-top:12px;padding:10px 13px;border-radius:7px;font-size:13px}.target-warning{background:#fff7ed;border:1px solid #fed7aa;border-left:3px solid #f97316;color:#9a3412}.error-note{background:#fff1f0;border:1px solid #ffccc7;border-left:3px solid #c62828;color:#8b1e1e}.error-code{margin-left:8px;color:var(--muted);font-family:ui-monospace,monospace}.precheck-block,.vision-block{margin-top:16px}.precheck-block h4,.vision-block h4{margin:0 0 8px;font-size:15px}.feature-table{width:100%;margin-top:12px;border-collapse:collapse;font-size:13px}.feature-table th,.feature-table td{padding:8px 10px;border:1px solid var(--border);vertical-align:top;text-align:left}.feature-table th{background:var(--surface)}.feature-table th:nth-child(1){width:22%}.feature-table th:nth-child(2){width:18%}.subsection{margin-top:13px;color:var(--muted);font-size:13px}.subsection strong{display:block;color:var(--text);margin-bottom:4px}.subsection ul,.verdict-reasons ul{margin:4px 0 0;padding-left:20px}.fusion-note{background:var(--surface);color:var(--muted)}.suggestion-note{background:#f0f7ff;border-left:3px solid #5790c9}.limitation-note{background:#fafafa;border-left:3px solid #a5adb5}.source-link{margin-top:13px;font-size:13px}.source-link a{color:#2864a5}.section>ul{margin:0;padding-left:20px;color:var(--muted);font-size:13px}@media(max-width:700px){.container{padding:20px 12px 36px}.summary-card{display:block}.query-img{width:190px}.comp-images{grid-template-columns:1fr}.meta,.definition-table{grid-template-columns:125px 1fr}}@media print{body{background:#fff}.container{max-width:none;padding:0}.section,.summary-card,.comp-card{box-shadow:none;break-inside:avoid}.notice{break-inside:avoid}}`;
}
