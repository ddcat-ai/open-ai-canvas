package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

// A detail plan is written as three page ranges at the same time. Output
// tokens dominate the planning time, so three parallel calls that each write a
// third of the pages finish in roughly a third of the time. Every batch gets
// the same whole-set outline, so pages do not repeat each other.
const ecommercePlanningBatchCount = 3

// ecommerceDetailPageOutline is the fallback page role of each screen, for
// tasks without a drawn design variation (ecommerceDetailOutline). It keeps at
// least two close-ups, three goals, three compositions and four component
// types in nine pages, which the rhythm checks require.
var ecommerceDetailPageOutline = []string{
	"卖点总览｜首屏：品牌情绪双色大标题 + 完整新品站在主题台座 + 3–4 个图标卖点气泡与引线 + 底部标语（商品状态：完整新品）",
	"场景注释｜情感使用场景：与品类匹配的模特正在使用商品（母婴如宝宝双手抱奶瓶开心喝奶），全幅人物大图 + 一角大标题 + 2 个短标签（商品状态：使用中）",
	"细节放大窗｜核心细节：商品中景 + 四角圆形放大窗展示真实局部（微距），每个放大窗配图标卖点卡片（商品状态：空置，看清透明度与内部结构）",
	"图标组｜核心功能卖点：3–4 个功能图标卡（功能名 + 一句说明），商品换角度（侧面或三分之四视角）（商品状态：与上屏不同的内容物量或开合状态）",
	"场景注释｜多场景拼图：顶部大标题 + 3 宫格场景卡（如居家/外出/成长，含模特），每格配图标与短说明（商品状态：三格各不相同）",
	"双栏对照｜痛点对比：普通做法与本商品设计分栏对照，强对比色与对勾叉号图标（商品状态：功能演示，如倒置不漏、密封）",
	"细节放大窗｜结构拆解：组件拆开平铺或爆炸分层，逐个标注部件与卖点（商品状态：拆解组件）",
	"场景注释｜另一真实使用场景：换环境、景别与人物动作（如外出携带或收纳）（商品状态：收纳或携带）",
	"规格卡｜产品信息收尾：上半部情感模特大图 + 大标题，下半部产品信息卡（容量/尺寸/材质/适用人群/核心特点等逐行图标列表）+ 底部标语（商品状态：完整新品）",
}

func ecommercePlanningOutline(count int) []string {
	outline := make([]string, count)
	for i := range outline {
		switch {
		case i == 0:
			outline[i] = ecommerceDetailPageOutline[0]
		case i == count-1 && count > 1:
			outline[i] = ecommerceDetailPageOutline[len(ecommerceDetailPageOutline)-1]
		default:
			outline[i] = ecommerceDetailPageOutline[1+(i-1)%(len(ecommerceDetailPageOutline)-2)]
		}
	}
	return outline
}

// ecommercePlanningBatchable selects ordinary detail plans: the model writes
// every page from the same direction, so the pages can be split by range.
// Long-image reference mode follows real screens and stays one call.
func ecommercePlanningBatchable(input canvasGenerationInput) (EcommerceDraft, bool) {
	var draft EcommerceDraft
	if input.Mode != "text" || input.AgentRequests != nil || metadataString(input.Metadata, "source") != "ecommerce-agent" || metadataString(input.Metadata, "stage") != "planning" || metadataString(input.Metadata, "ecommerceAgentAdapter") != "workbench-v1" {
		return draft, false
	}
	raw, _ := json.Marshal(input.Metadata["ecommerceDraft"])
	if json.Unmarshal(raw, &draft) != nil {
		return draft, false
	}
	return draft, draft.ImageType == "detail" && draft.ReferenceMode != "detail" && draft.Count >= 6 && draft.Count <= 30
}

func ecommercePlanningBatchRanges(count int) [][2]int {
	ranges := make([][2]int, 0, ecommercePlanningBatchCount)
	start := 1
	for batch := 0; batch < ecommercePlanningBatchCount; batch++ {
		size := count / ecommercePlanningBatchCount
		if batch < count%ecommercePlanningBatchCount {
			size++
		}
		ranges = append(ranges, [2]int{start, start + size - 1})
		start += size
	}
	return ranges
}

// ecommercePlanningBatchPrompt asks one batch for its page range of the shared
// whole-set outline (one entry per page).
func ecommercePlanningBatchPrompt(prompt string, outline []string, span [2]int) string {
	count := len(outline)
	var b strings.Builder
	b.WriteString(prompt)
	fmt.Fprintf(&b, "\n\n【分批策划，优先于以上张数与 id 要求】整套共 %d 张，由三个并行任务按同一大纲分别撰写。本次只输出第 %d–%d 张：images 必须恰好 %d 项，id 依次为 image-%d 至 image-%d。productSummary、visualStrategy、confirmedFacts、uncertainFacts、qualityChecks 仍按整套撰写。只写本次负责的页面，不要重复大纲中其他页面的主题、标题和卖点。\n【整套页面大纲】\n", count, span[0], span[1], span[1]-span[0]+1, span[0], span[1])
	for i, page := range outline {
		marker := ""
		if i+1 >= span[0] && i+1 <= span[1] {
			marker = "（本次撰写）"
		}
		fmt.Fprintf(&b, "%d. %s%s\n", i+1, page, marker)
	}
	b.WriteString("本次每一页的 informationComponent 以大纲中对应的分类开头。")
	return b.String()
}

// runEcommercePlanningBatches runs the page ranges in parallel and merges them
// into one plan with the same JSON contract as a single call. A failed batch
// is retried once; the task fails only if a batch still cannot be parsed.
func runEcommercePlanningBatches(ctx context.Context, input canvasGenerationInput, draft EcommerceDraft) (map[string]interface{}, error) {
	ranges := ecommercePlanningBatchRanges(draft.Count)
	// All batches share the run's drawn outline, so their pages fit together.
	outline := ecommerceDetailOutline(input.Metadata, draft.Count)
	plans := make([]model.EcommercePlan, len(ranges))
	errs := make([]error, len(ranges))
	started := time.Now()
	var wg sync.WaitGroup
	for index, span := range ranges {
		wg.Add(1)
		go func() {
			defer wg.Done()
			batch := input
			batch.Prompt = ecommercePlanningBatchPrompt(input.Prompt, outline, span)
			// Parallel batches cannot share one live text draft.
			batch.StreamText, batch.OnTextDelta, batch.OnReasoningDelta = false, nil, nil
			want := span[1] - span[0] + 1
			for attempt := 0; attempt < 2; attempt++ {
				if ctx.Err() != nil {
					errs[index] = ctx.Err()
					return
				}
				result, err := runTextTask(ctx, batch)
				if err == nil {
					var plan model.EcommercePlan
					err = ecommerceParseJSON(stringValue(result["text"]), &plan)
					if err == nil && len(plan.Images) == draft.Count && want != draft.Count {
						// The model wrote the whole set; keep only this batch's pages.
						plan.Images = plan.Images[span[0]-1 : span[1]]
					}
					if err == nil && len(plan.Images) != want {
						err = fmt.Errorf("第 %d–%d 张只返回了 %d 张", span[0], span[1], len(plan.Images))
					}
					if err == nil {
						plans[index], errs[index] = plan, nil
						return
					}
				}
				errs[index] = err
				slog.Warn("ecommerce planning batch failed", "batch", index+1, "attempt", attempt+1, "error", err)
			}
		}()
	}
	wg.Wait()
	for index, err := range errs {
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil, err
			}
			return nil, BadAuthRequest(fmt.Sprintf("第 %d–%d 张的策划未完成：%v，请重新策划", ranges[index][0], ranges[index][1], err))
		}
	}
	merged := plans[0]
	merged.Images = nil
	checks := map[string]bool{}
	merged.QualityChecks = nil
	for _, plan := range plans {
		merged.Images = append(merged.Images, plan.Images...)
		for _, check := range plan.QualityChecks {
			if check = strings.TrimSpace(check); check != "" && !checks[check] {
				checks[check] = true
				merged.QualityChecks = append(merged.QualityChecks, check)
			}
		}
	}
	for i := range merged.Images {
		merged.Images[i].ID = fmt.Sprintf("image-%d", i+1)
	}
	if merged.ConfirmedFacts == nil {
		merged.ConfirmedFacts = []string{}
	}
	if merged.UncertainFacts == nil {
		merged.UncertainFacts = []string{}
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return nil, err
	}
	slog.Info("ecommerce planning batches merged", "pages", len(merged.Images), "batches", len(ranges), "ms", time.Since(started).Milliseconds())
	return map[string]interface{}{"mode": "text", "text": string(raw)}, nil
}
