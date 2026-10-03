import type { AgentApproval, AgentOutputPreference } from "@/services/api/agent";
import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CreationAgentPlanItem, CreationCommercePlan } from "./creation-types";

type ReviewProps = {
    outputPreference?: AgentOutputPreference;
    plan?: CreationCommercePlan;
    items?: CreationAgentPlanItem[];
    approval?: AgentApproval;
    changed?: boolean;
    submitting: boolean;
    onApprove: () => void;
    onReject: () => void;
    onModify?: (notes: string) => Promise<boolean>;
    onDefer?: () => void;
    onRefreshQuote?: () => void;
};

const roleNames: Record<string, string> = { product: "产品", competitor: "竞品风格", style: "风格", reference: "一般参考", person: "人物", source: "源素材" };
const referenceNames: Record<string, string> = { image: "图", video: "视频", audio: "音频" };
const layoutNames: Record<string, string> = { product_only: "产品主体", hero_lifestyle: "核心场景", feature_infographic: "卖点信息图", detail_callout: "细节放大", multi_scene: "多场景拼接", comparison: "对照展示", specification: "规格说明", lifestyle_finish: "生活方式收尾", custom: "定制版式" };
const imageRoleNames: Record<string, string> = { main: "白底主图", secondary: "商品副图", a_plus: "A+ 内容", banner: "横幅", other: "其他" };

export function CreationAgentReview({ outputPreference = "detailed", plan, items, approval, changed, submitting, onApprove, onReject, onModify, onDefer, onRefreshQuote }: ReviewProps) {
    const [notes, setNotes] = useState("");
    const [modifying, setModifying] = useState(false);
    const detailed = outputPreference === "detailed";
    const [expanded, setExpanded] = useState(detailed);
    const detailsId = useId();
    useEffect(() => { setExpanded(detailed); }, [detailed]);
    if (!plan && !items?.length && !approval) return null;
    const references = new Map((plan?.references || []).map((item) => [item.resourceId, item]));
    const factNames = new Map((plan?.productFacts || []).map((fact) => [fact.id, fact.claim]));
    const domestic = plan?.language.toLowerCase().startsWith("zh");
    const estimate = plan?.estimateStatus === "quoted" && typeof plan.estimatedCredits === "number" ? `${plan.estimatedCredits} 积分${typeof plan.maxCredits === "number" ? `（本轮上限 ${plan.maxCredits}）` : ""}` : "当前无法估算；执行仍受本轮预算限制";
    const compactSpecs = [...new Set((plan?.items || []).map((item) => Object.values(item.specs || {}).map(String).join(" · ")).filter(Boolean))].join("；");
    const planHeading = <div className="creation-agent-plan-header"><h3>{plan ? "重要信息" : "执行计划"}</h3><button type="button" className="creation-agent-plan-toggle" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? "收起" : "展开"}${plan ? "重要信息" : "执行计划"}`} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}{expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button></div>;
    return <section className="creation-agent-review" aria-label="Agent 计划与审批">
        {plan ? <div className="creation-agent-plan">
            {planHeading}
            <div id={detailsId}>{expanded ? <>
            <dl className="creation-agent-plan-summary">
                <div><dt>创作目标</dt><dd>{plan.intent}</dd></div>
                <div><dt>技能</dt><dd>{plan.skills?.map((skill) => skill.name).join("、") || "未使用专业技能"}</dd></div>
                <div><dt>平台/站点</dt><dd>{plan.platform} / {plan.site}</dd></div>
                <div><dt>上图语言及版本</dt><dd>{plan.languageVariants?.length ? plan.languageVariants.join("、") : plan.language} · {plan.items.length} 项交付</dd></div>
                <div><dt>交付数量</dt><dd>{plan.items.length}</dd></div>
                <div><dt>整套风格</dt><dd>{plan.styleBible || "按各图画面设计"}</dd></div>
                {plan.styleLock ? <div><dt>整套风格锁定</dt><dd className="creation-agent-style-lock"><p>字体：{plan.styleLock.fontFamily} · {plan.styleLock.typography}</p><div className="creation-agent-style-colors">{([["标题", plan.styleLock.headingColor], ["正文", plan.styleLock.bodyColor], ["强调", plan.styleLock.accentColor], ["图形背景", plan.styleLock.backgroundColor]] as const).map(([label, color]) => <span key={label}><i style={{ backgroundColor: color }} aria-hidden="true" />{label} {color}</span>)}</div><p>图标：{plan.styleLock.iconStyle}。所有图片共用；产品与场景保留自然颜色。</p></dd></div> : null}
                <div><dt>实际参考素材</dt><dd>{plan.references?.length ? plan.references.map((reference) => `${reference.index ? `${referenceNames[reference.kind || ""] || "素材"}${reference.index} · ` : ""}${reference.name}（${roleNames[reference.role] || reference.role}）${reference.usage ? `：${reference.usage}` : ""}`).join("；") : "无"}</dd></div>
                <div><dt>采用的产品事实</dt><dd>{plan.productFacts.filter((fact) => !fact.status || fact.status === "supported").map((fact) => `${fact.claim}（来源：${fact.sourceIds.map((id) => references.get(id)?.name || id).join("、")}）`).join("；") || "无已证实事实"}</dd></div>
                <div><dt>未确认且不用的事实</dt><dd>{plan.productFacts.filter((fact) => fact.status === "unknown" || fact.status === "inferred").map((fact) => fact.claim).join("；") || "无"}</dd></div>
                <div><dt>默认处理/平台冲突</dt><dd>{[...(plan.assumptions || []), ...(plan.conflicts || [])].join("；") || "无"}</dd></div>
                <div><dt>预计消耗</dt><dd>{estimate}</dd></div>
            </dl>
            <h3>逐图方案</h3>
            <ol>{plan.items.map((item) => <li key={item.id}>
                <strong>用途：{item.purpose}</strong><span> · {item.title}{item.language ? ` · 目标语言：${item.language}` : ""}</span>
                {item.design ? <div className="creation-agent-image-design"><p>版式：{imageRoleNames[item.design.role] || item.design.role} · {layoutNames[item.design.layout] || item.design.layout}</p><p>视觉焦点：{item.design.focalPoint}</p><p>构图分区：{item.design.composition}</p><p>文字层次：{plan.styleLock ? `沿用整套 ${plan.styleLock.fontFamily}；${plan.styleLock.typography}` : item.design.typography}</p><p>配色：{plan.styleLock ? `沿用整套风格锁定；产品与场景保留自然颜色` : item.design.palette}</p></div> : null}
                <p>画面设计：{item.prompt}</p>
                <p>实际上图文案：{item.targetCopy.trim() || "本图不放文字"}</p>
                {!domestic ? <p>中文对照：{item.targetCopy.trim() ? item.zhReviewCopy || "缺少中文审核对照" : "本图不放文字"}</p> : null}
                <p>规格：{item.specs && Object.keys(item.specs).length ? Object.entries(item.specs).map(([key, value]) => `${key} ${String(value)}`).join(" · ") : "按所选模型默认规格"}</p>
                <p>依据事实/素材：{[...(item.factIds || []).map((id) => factNames.get(id) || id), ...item.attachmentResourceIds.map((id) => references.get(id)?.name || id)].join("；") || "无引用"}</p>
            </li>)}</ol>
            </> : <dl className="creation-agent-plan-summary is-compact">
                <div><dt>创作目标</dt><dd>{plan.intent}</dd></div>
                <div><dt>平台/站点</dt><dd>{plan.platform} / {plan.site}</dd></div>
                <div><dt>上图语言及版本</dt><dd>{plan.languageVariants?.length ? plan.languageVariants.join("、") : plan.language} · {plan.items.length} 项交付</dd></div>
                {compactSpecs ? <div><dt>规格</dt><dd>{compactSpecs}</dd></div> : null}
                <div><dt>预计消耗</dt><dd>{estimate}</dd></div>
            </dl>}</div>
        </div> : items?.length ? <div className="creation-agent-plan">{planHeading}<ol id={detailsId}>{items.map((item) => <li key={item.id} data-status={item.status}><span>{item.title}</span><small>{item.status === "done" ? "完成" : item.status === "doing" ? "执行中" : "待执行"}</small>{expanded && item.targetCopy ? <p>目标文案：{item.targetCopy}</p> : null}{expanded && item.zhReviewCopy ? <p>中文审核：{item.zhReviewCopy}</p> : null}{item.specs && Object.keys(item.specs).length ? <p>规格：{Object.entries(item.specs).map(([key, value]) => `${key} ${String(value)}`).join(" · ")}</p> : null}</li>)}</ol></div> : null}
        {plan && onModify && (approval || detailed) ? <div className="creation-agent-plan-notes"><label>修改备注<textarea aria-label="修改备注" placeholder="例如：全部改为 1K；标题再醒目一些；统一用蓝色强调色…" maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={submitting || modifying} /></label>{detailed ? <p>满意可直接批准生成；需要调整分辨率、文案或风格时，填写备注并修改方案，规格会按备注重新规划，所选执行模型保持；新版会重新报价供你审批。</p> : null}<button type="button" disabled={submitting || modifying || !notes.trim()} onClick={async () => { if (!onModify || modifying) return; setModifying(true); try { if (await onModify(notes.trim())) setNotes(""); } finally { setModifying(false); } }}>{modifying ? "正在修改方案…" : "按备注修改方案"}</button></div> : null}
        {approval ? <div className="creation-agent-approval"><h3>{approval.preview?.title || "等待执行审批"}</h3>
            {approval.preview?.description ? <p>{approval.preview.description}</p> : null}
            {approval.preview?.items?.length ? <ul>{approval.preview.items.map((item, index) => <li key={`${item.operation}-${index}`}><strong>{item.summary}</strong>{(detailed || !plan) && item.details?.length ? <span>{item.details.join(" · ")}</span> : null}</li>)}</ul> : null}
            {changed ? <p className="creation-agent-approval-changed" role="alert">设置已变更，请修改方案后重新审批。</p> : null}
            {plan && detailed ? <p>可以稍后处理，方案会保留在创作历史中。报价过期时可更新报价后继续批准。</p> : null}
            <div className="creation-agent-approval-actions">{onRefreshQuote ? <button type="button" onClick={onRefreshQuote} disabled={submitting || modifying}>更新报价</button> : null}{onDefer ? <button type="button" onClick={onDefer} disabled={submitting || modifying}>稍后处理</button> : null}<button type="button" onClick={onReject} disabled={submitting || modifying}>{plan ? "仅保留方案" : "拒绝计划"}</button><button type="button" onClick={onApprove} disabled={submitting || modifying || changed}>{plan ? "确认整套生成" : "批准执行"}</button></div>
        </div> : null}
    </section>;
}
