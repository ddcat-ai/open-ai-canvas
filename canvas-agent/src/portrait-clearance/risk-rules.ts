import { highestRisk, riskFromFaceSimilarity, type PortraitClearanceResult, type PortraitImageQuality, type PortraitLocalPrecheck, type PortraitRiskLevel, type PortraitVisionComparison } from "./contracts.js";
import { colorHistogramCorrelation, structuralSimilarity, type DecodedPortraitImage } from "./image-metrics.js";
import type { PortraitFaceAnalysis } from "./face-engine.js";

export function buildLocalPrecheck(
    imageA: DecodedPortraitImage,
    imageB: DecodedPortraitImage,
    facesA?: PortraitFaceAnalysis,
    facesB?: PortraitFaceAnalysis,
    extraIssues: string[] = [],
): PortraitLocalPrecheck {
    const reliabilityIssues = [...extraIssues];
    const selectedFaceA = toFaceContract(facesA?.selectedFace);
    const selectedFaceB = toFaceContract(facesB?.selectedFace);
    if (imageA.quality.grade === "poor") reliabilityIssues.push("图片 A 质量过低，模糊、过暗、过曝或对比度不足会导致人脸特征不可靠。");
    if (imageB.quality.grade === "poor") reliabilityIssues.push("图片 B 质量过低，模糊、过暗、过曝或对比度不足会导致人脸特征不可靠。");
    if ((facesA?.faces.length ?? 0) > 1) reliabilityIssues.push("图片 A 检测到多张人脸，未指定目标对象，无法可靠判断。");
    if ((facesB?.faces.length ?? 0) > 1) reliabilityIssues.push("图片 B 检测到多张人脸，未指定目标对象，无法可靠判断。");
    if (facesA?.selectedFace && facesA.selectedFace.detScore < 0.65) reliabilityIssues.push(`图片 A 人脸检测置信度较低（${facesA.selectedFace.detScore.toFixed(4)}），特征提取不稳定。`);
    if (facesB?.selectedFace && facesB.selectedFace.detScore < 0.65) reliabilityIssues.push(`图片 B 人脸检测置信度较低（${facesB.selectedFace.detScore.toFixed(4)}），特征提取不稳定。`);
    if (facesA?.selectedFace && facesA.selectedFace.areaRatio < 0.02) reliabilityIssues.push(`图片 A 人脸区域占比过小（${facesA.selectedFace.areaRatio.toFixed(4)}），本地特征比对不可靠。`);
    if (facesB?.selectedFace && facesB.selectedFace.areaRatio < 0.02) reliabilityIssues.push(`图片 B 人脸区域占比过小（${facesB.selectedFace.areaRatio.toFixed(4)}），本地特征比对不可靠。`);
    return {
        qualityA: imageA.quality,
        qualityB: imageB.quality,
        facesA: facesA?.faces.length ?? 0,
        facesB: facesB?.faces.length ?? 0,
        ...(selectedFaceA ? { selectedFaceA } : {}),
        ...(selectedFaceB ? { selectedFaceB } : {}),
        ...(facesA?.embedding && facesB?.embedding ? { faceSimilarity: round(cosine(facesA.embedding, facesB.embedding), 4) } : {}),
        ssim: structuralSimilarity({ width: imageA.width, height: imageA.height, values: imageA.gray }, { width: imageB.width, height: imageB.height, values: imageB.gray }),
        colorHistogramCorrelation: colorHistogramCorrelation(imageA.rgb, imageB.rgb),
        canExtractEmbedding: Boolean(facesA?.embedding && facesB?.embedding),
        reliabilityIssues: unique(reliabilityIssues),
    };
}

export function localRisk(precheck: PortraitLocalPrecheck): PortraitRiskLevel {
    if (!precheck.canExtractEmbedding || precheck.reliabilityIssues.length > 0 || precheck.facesA !== 1 || precheck.facesB !== 1) return "unable_to_determine";
    return riskFromFaceSimilarity(precheck.faceSimilarity);
}

export function applyStylizedRiskFloor(comparison: PortraitVisionComparison): PortraitVisionComparison {
    if (comparison.analysisPath !== "B" || comparison.featureComparison.distinctive_features.similarity !== "high") return comparison;
    const risk = riskAtLeast(comparison.riskLevel, "medium");
    if (risk === comparison.riskLevel) return comparison;
    return {
        ...comparison,
        riskLevel: risk,
        basis: [...comparison.basis, "风格化路径中标志性特征被判断为高度相似，综合风险下限提升至中风险，建议人工复核。"],
        manualReviewRecommended: true,
    };
}

export function summarizeRisk(pairs: Array<{ riskLevel: PortraitRiskLevel }>) {
    const riskCounts: Partial<Record<PortraitRiskLevel, number>> = {};
    for (const pair of pairs) riskCounts[pair.riskLevel] = (riskCounts[pair.riskLevel] ?? 0) + 1;
    return { highestRisk: highestRisk(pairs.map((pair) => pair.riskLevel)), riskCounts };
}

export function buildReliabilityIssues(quality: PortraitImageQuality, faces: number) {
    const issues: string[] = [];
    if (quality.grade === "poor") issues.push("图片质量过低，无法可靠提取肖像特征。");
    if (faces === 0) issues.push("未检测到人脸。");
    if (faces > 1) issues.push("检测到多张人脸，未指定目标对象。");
    return issues;
}

function toFaceContract(face: PortraitFaceAnalysis["selectedFace"]) {
    if (!face) return undefined;
    return { bbox: face.bbox, detScore: face.detScore, areaRatio: face.areaRatio } as const;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
    let dot = 0;
    let left = 0;
    let right = 0;
    for (let index = 0; index < a.length; index += 1) {
        dot += Number(a[index]) * Number(b[index]);
        left += Number(a[index]) ** 2;
        right += Number(b[index]) ** 2;
    }
    return dot / Math.max(Number.EPSILON, Math.sqrt(left * right));
}

function riskAtLeast(current: PortraitRiskLevel, floor: PortraitRiskLevel) {
    const order: PortraitRiskLevel[] = ["unable_to_determine", "low", "low_to_medium", "medium", "high"];
    return order[Math.max(order.indexOf(current), order.indexOf(floor))]!;
}

function unique(values: string[]) {
    return [...new Set(values)];
}

function round(value: number, digits: number) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
