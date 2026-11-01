export const commerceKnowledgeDomains = [
    { id: "KB01", label: "全球电商行业" },
    { id: "KB02", label: "商品卖点与营销" },
    { id: "KB03", label: "高级视觉设计" },
    { id: "KB04", label: "主图与详情页排版" },
    { id: "KB05", label: "电商文案" },
    { id: "KB06", label: "商业产品摄影" },
    { id: "KB07", label: "模特与场景" },
    { id: "KB08", label: "国内外平台规范" },
    { id: "KB09", label: "热点与创意趋势" },
    { id: "KB10", label: "真实还原与质量控制" },
] as const;

export function commerceKnowledgeDomainRows(coverage?: Record<string, number>) {
    return commerceKnowledgeDomains.map(({ id, label }) => ({ id, label, count: Math.max(0, Number(coverage?.[id]) || 0) }));
}
