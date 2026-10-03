package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"infinite-canvas/backend/internal/repository"
)

// A commerce plan is an immutable, versioned input to the existing media tool.
// It does not own a task queue: each item is admitted by generate_media.
type cloudAgentCommercePlan struct {
	PlanVersion      string                        `json:"planVersion"`
	PlanID           string                        `json:"planId"`
	Version          int                           `json:"version"`
	Intent           string                        `json:"intent"`
	Platform         string                        `json:"platform"`
	Site             string                        `json:"site"`
	Language         string                        `json:"language"`
	LanguageVariants []string                      `json:"languageVariants,omitempty"`
	ProductFacts     []cloudAgentCommerceFact      `json:"productFacts"`
	Items            []cloudAgentCommerceItem      `json:"items"`
	StyleBible       string                        `json:"styleBible,omitempty"`
	StyleLock        *cloudAgentCommerceStyleLock  `json:"styleLock,omitempty"`
	Assumptions      []string                      `json:"assumptions,omitempty"`
	Rules            []cloudAgentCommerceRule      `json:"rules,omitempty"`
	References       []cloudAgentCreationReference `json:"references,omitempty"`
}

type cloudAgentCommerceFact struct {
	ID        string   `json:"id"`
	Claim     string   `json:"claim"`
	SourceIDs []string `json:"sourceIds"`
	Status    string   `json:"status,omitempty"`
}

type cloudAgentCommerceItem struct {
	ID                    string                    `json:"id"`
	Type                  string                    `json:"type"`
	Operation             string                    `json:"operation,omitempty"`
	Purpose               string                    `json:"purpose"`
	Title                 string                    `json:"title"`
	Prompt                string                    `json:"prompt"`
	TargetCopy            string                    `json:"targetCopy"`
	ChineseReviewCopy     string                    `json:"zhReviewCopy"`
	Language              string                    `json:"language,omitempty"`
	FactIDs               []string                  `json:"factIds,omitempty"`
	AttachmentResourceIDs []string                  `json:"attachmentResourceIds"`
	Dependencies          []string                  `json:"dependencies,omitempty"`
	Specs                 map[string]any            `json:"specs,omitempty"`
	Design                *cloudAgentCommerceDesign `json:"design,omitempty"`
}

type cloudAgentCommerceRule struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	SourceURL string `json:"sourceUrl"`
	CheckedAt string `json:"checkedAt"`
}

func cloudAgentParseCommercePlan(req CloudAgentRequest, call cloudAgentCall) (*cloudAgentCommercePlan, error) {
	var plan cloudAgentCommercePlan
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &plan); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		return nil, &cloudAgentArgumentError{err}
	}
	// Model-supplied rule prose is never treated as platform authority.
	plan.Rules = cloudAgentCommerceRules(plan.Platform, plan.Site)
	return &plan, nil
}

func cloudAgentCommercePlanToolProperties() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	stringsSchema := func(max int) map[string]any {
		return map[string]any{"type": "array", "maxItems": max, "items": map[string]any{"type": "string"}}
	}
	return map[string]any{
		"references":       cloudAgentCreationReferenceSchema(),
		"planVersion":      map[string]any{"type": "string", "enum": []string{"2"}},
		"planId":           str("稳定计划 ID；同一版本重放时保持不变"),
		"version":          map[string]any{"type": "integer", "minimum": 1},
		"intent":           str("用户原始创作目标与硬约束"),
		"platform":         map[string]any{"type": "string", "enum": []string{"amazon", "pinduoduo", "taobao", "tmall", "jd", "tiktok_shop", "aliexpress", "shopee", "walmart", "shopify", "generic", "unknown"}},
		"site":             str("目标站点国家代码；未知填 UNKNOWN，不能默认为 US"),
		"language":         str("目标语言 BCP 47 标签；未知填 und"),
		"languageVariants": stringsSchema(12),
		"productFacts":     map[string]any{"type": "array", "maxItems": 60, "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"id": str("稳定事实 ID"), "claim": str("产品事实或明确未确认的候选"), "sourceIds": stringsSchema(16), "status": map[string]any{"type": "string", "enum": []string{"supported", "inferred", "unknown"}}}, "required": []string{"id", "claim", "sourceIds"}}},
		"items": map[string]any{"type": "array", "minItems": 1, "maxItems": 20, "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
			"id": str("稳定交付项 ID"), "type": map[string]any{"type": "string", "enum": []string{"image", "video", "text"}}, "operation": str("可选，视频替换必须具备真实能力；否则会拒绝"),
			"purpose": str("用途"), "title": str("短标题"), "prompt": str("仅目标市场图像提示，不含中文审核翻译"), "targetCopy": str("画面目标语言文案，无文案填空字符串；多行按行对应中文审核"), "zhReviewCopy": str("仅审核展示的中文对照，无文案填空字符串"), "language": str("多语言方案中本项的目标语言"),
			"factIds": stringsSchema(60), "attachmentResourceIds": stringsSchema(16), "dependencies": stringsSchema(20),
			"design": cloudAgentCommerceDesignSchema(),
			"specs":  map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"size": str("输出画布比例或像素尺寸，不是商品本体比例；Amazon 商品图库默认 1:1，优先模型支持的约 2000 像素方图；尊重用户明确规格"), "quality": str("模型生成质量；low/medium/high 等不参与定价"), "durationSeconds": map[string]any{"type": "integer", "minimum": 0, "maximum": 120}}},
		}, "required": []string{"id", "type", "purpose", "title", "prompt", "targetCopy", "zhReviewCopy", "attachmentResourceIds"}}},
		"styleBible":  str("整套统一视觉、产品外观和不可改变特征"),
		"styleLock":   cloudAgentCommerceStyleLockSchema(),
		"assumptions": stringsSchema(20),
		"rules":       map[string]any{"type": "array", "maxItems": 0, "items": map[string]any{"type": "object"}, "description": "留空；平台规则由服务端官方来源目录填充"},
	}
}

func validateCloudAgentCommercePlan(req CloudAgentRequest, plan *cloudAgentCommercePlan) error {
	if req.Surface != "creation" || plan == nil {
		return BadAuthRequest("电商计划仅可用于创作入口")
	}
	attachmentsWithRoles, err := cloudAgentCreationReferenceRoles(req, plan.References)
	if err != nil {
		return err
	}
	req.Attachments = attachmentsWithRoles
	if plan.PlanVersion != "2" || strings.TrimSpace(plan.PlanID) == "" || plan.Version < 1 || strings.TrimSpace(plan.Intent) == "" {
		return BadAuthRequest("电商计划缺少稳定 ID、版本或创作意图")
	}
	switch plan.Platform {
	case "amazon", "pinduoduo", "taobao", "tmall", "jd", "tiktok_shop", "aliexpress", "shopee", "walmart", "shopify", "generic", "unknown":
	default:
		return BadAuthRequest("电商计划平台无效；未知平台请标为 unknown")
	}
	if strings.TrimSpace(plan.Site) == "" || strings.TrimSpace(plan.Language) == "" {
		return BadAuthRequest("电商计划须明确站点和目标语言；未知请标为 UNKNOWN/und")
	}
	if len(plan.Items) == 0 || len(plan.Items) > 20 {
		return BadAuthRequest("电商计划交付项须为 1 至 20 项")
	}
	if err := validateCloudAgentCommerceDesign(plan); err != nil {
		return err
	}
	if len(plan.ProductFacts) > 60 {
		return BadAuthRequest("产品事实过多")
	}
	variants := make(map[string]bool, len(plan.LanguageVariants))
	for _, language := range plan.LanguageVariants {
		if strings.TrimSpace(language) == "" || variants[language] {
			return BadAuthRequest("目标语言版本必须明确且不重复")
		}
		variants[language] = true
	}
	if len(variants) > 1 && plan.Language != "mul" {
		return BadAuthRequest("多语言计划须以 mul 标明整套语言，并逐项注明目标语言")
	}
	if err := cloudAgentCommerceCheckReviewCopy(plan); err != nil {
		return err
	}
	attachments := map[string]CloudAgentAttachment{}
	for _, attachment := range req.Attachments {
		attachments[attachment.ResourceID] = attachment
	}
	facts := map[string]bool{}
	for _, fact := range plan.ProductFacts {
		status := firstNonEmpty(fact.Status, "supported")
		if status != "supported" && status != "inferred" && status != "unknown" {
			return BadAuthRequest("产品事实状态无效")
		}
		if fact.ID == "" || strings.TrimSpace(fact.Claim) == "" || facts[fact.ID] || status == "supported" && len(fact.SourceIDs) == 0 {
			return BadAuthRequest("产品事实 ID、内容或证据来源无效")
		}
		facts[fact.ID] = status == "supported"
		for _, id := range fact.SourceIDs {
			if id == "user:prompt" && strings.Contains(req.Prompt, fact.Claim) {
				continue
			}
			attachment, ok := attachments[id]
			if !ok {
				return BadAuthRequest("产品事实来源不在本轮授权附件中")
			}
			if attachment.Role == "competitor" || attachment.Role == "style" || attachment.Role == "reference" {
				return BadAuthRequest("竞品、风格或一般参考素材不能证明产品事实")
			}
		}
		if status == "supported" {
			if _, err := cloudAgentCommerceRenderFactClaim(plan, fact); err != nil {
				return err
			}
		}
	}
	items := map[string]cloudAgentCommerceItem{}
	for _, item := range plan.Items {
		if item.ID == "" || items[item.ID].ID != "" || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Prompt) == "" {
			return BadAuthRequest("电商计划交付项缺少唯一 ID、标题或提示词")
		}
		if item.Type != "image" && item.Type != "video" && item.Type != "text" {
			return BadAuthRequest("电商计划交付类型无效")
		}
		if len(variants) > 1 && !variants[item.Language] {
			return BadAuthRequest("多语言交付项须注明已列出的目标语言版本")
		}
		if len(variants) <= 1 && item.Language != "" && item.Language != plan.Language && !variants[item.Language] {
			return BadAuthRequest("交付项语言与整套方案不一致")
		}
		if len(item.Prompt) > 16000 || len(item.AttachmentResourceIDs) > 16 {
			return BadAuthRequest("电商计划提示词或素材数量超过上限")
		}
		for _, id := range item.AttachmentResourceIDs {
			if _, ok := attachments[id]; !ok {
				return BadAuthRequest("电商计划引用了非本轮授权素材")
			}
		}
		if _, _, _, err := cloudAgentCommerceValidatedSpecs(item.Specs); err != nil {
			return err
		}
		if item.Type == "video" && item.Operation == "image_to_video" {
			hasImage := false
			for _, id := range item.AttachmentResourceIDs {
				hasImage = hasImage || attachments[id].Kind == "image"
			}
			if !hasImage {
				return BadAuthRequest("图片转视频需要本轮已授权且就绪的图片素材")
			}
		}
		if item.Type == "video" {
			hasSourceVideo, hasReplacementImage := false, false
			for _, id := range item.AttachmentResourceIDs {
				attachment := attachments[id]
				hasSourceVideo = hasSourceVideo || attachment.Kind == "video" && attachment.Role == "source"
				hasReplacementImage = hasReplacementImage || attachment.Kind == "image" && (attachment.Role == "person" || attachment.Role == "product")
			}
			if hasSourceVideo && hasReplacementImage {
				return BadAuthRequest("源视频人物或产品替换缺少已声明的真实模型能力，不能仅用提示词执行")
			}
		}
		for _, id := range item.FactIDs {
			if !facts[id] {
				return BadAuthRequest("交付项只能引用已支持且锁定的产品事实")
			}
		}
		if item.Type == "video" && strings.HasPrefix(item.Operation, "replace_") {
			return BadAuthRequest("源视频人物或产品替换缺少已声明的真实模型能力，不能仅用提示词执行")
		}
		items[item.ID] = item
	}
	for _, item := range plan.Items {
		for _, id := range item.Dependencies {
			if id == item.ID || items[id].ID == "" {
				return BadAuthRequest("电商计划任务依赖无效")
			}
		}
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) bool
	visit = func(id string) bool {
		if visiting[id] {
			return false
		}
		if visited[id] {
			return true
		}
		visiting[id] = true
		for _, parent := range items[id].Dependencies {
			if !visit(parent) {
				return false
			}
		}
		visiting[id], visited[id] = false, true
		return true
	}
	for id := range items {
		if !visit(id) {
			return BadAuthRequest("电商计划存在循环依赖")
		}
	}
	return nil
}

func cloudAgentCommerceCheckReviewCopy(plan *cloudAgentCommercePlan) error {
	for _, reviewed := range plan.Items {
		language := firstNonEmpty(reviewed.Language, plan.Language)
		if strings.HasPrefix(strings.ToLower(language), "zh") {
			continue
		}
		target := strings.TrimSpace(reviewed.TargetCopy)
		copy := strings.TrimSpace(reviewed.ChineseReviewCopy)
		if target != "" && copy == "" {
			return BadAuthRequest("非中文画面文案须逐条提供中文审核对照")
		}
		if target == "" && copy != "" {
			return BadAuthRequest("无字图不能附带待上图的中文审核文案")
		}
		if copy == "" {
			continue
		}
		targetLines, reviewLines := strings.Split(target, "\n"), strings.Split(copy, "\n")
		if len(targetLines) != len(reviewLines) {
			return BadAuthRequest("目标语言文案与中文审核须逐行一一对应")
		}
		for index := range targetLines {
			reviewLine := strings.TrimSpace(reviewLines[index])
			if strings.TrimSpace(targetLines[index]) == "" || reviewLine == "" {
				return BadAuthRequest("上图文案与中文审核不能包含空行")
			}
			// Names, numbers and labels such as Before/After can be identical in
			// both columns without carrying a Chinese translation into the image.
			if reviewLine == strings.TrimSpace(targetLines[index]) && !strings.ContainsFunc(reviewLine, func(r rune) bool { return unicode.Is(unicode.Han, r) }) {
				continue
			}
			if plan.StyleLock != nil && strings.Contains(cloudAgentCommerceStyleLockPrompt(plan.StyleLock), reviewLine) {
				return BadAuthRequest("中文审核对照不能写入整套风格锁定")
			}
			if strings.Contains(plan.StyleBible, reviewLine) {
				return BadAuthRequest("中文审核对照不能写入视觉规范")
			}
			for _, reference := range plan.References {
				if strings.Contains(reference.Usage, reviewLine) {
					return BadAuthRequest("中文审核对照不能写入素材用途")
				}
			}
			for _, item := range plan.Items {
				if strings.HasPrefix(strings.ToLower(firstNonEmpty(item.Language, plan.Language)), "zh") {
					continue
				}
				if strings.Contains(item.Prompt, reviewLine) || strings.Contains(item.TargetCopy, reviewLine) {
					return BadAuthRequest("中文审核对照不能写入目标语言生成提示词或画面文案")
				}
				if item.Design != nil && strings.Contains(cloudAgentCommerceDesignPrompt(item.Design), reviewLine) {
					return BadAuthRequest("中文审核对照不能写入逐图视觉设计")
				}
			}
		}
	}
	return nil
}

func cloudAgentCommerceRenderFactClaim(plan *cloudAgentCommercePlan, fact cloudAgentCommerceFact) (string, error) {
	claim := strings.TrimSpace(fact.Claim)
	if plan.Language == "zh-CN" {
		return claim, nil
	}
	pairedCopy := ""
	for _, item := range plan.Items {
		review := strings.TrimSpace(item.ChineseReviewCopy)
		if review == "" || !strings.Contains(claim, review) {
			continue
		}
		if claim != review || strings.TrimSpace(item.TargetCopy) == "" {
			return "", BadAuthRequest("产品事实与中文审核文案重叠，须提供完整且明确配对的目标语言事实文案")
		}
		target := strings.TrimSpace(item.TargetCopy)
		if pairedCopy != "" && pairedCopy != target {
			return "", BadAuthRequest("相同产品事实对应不同目标语言文案，请先统一计划")
		}
		pairedCopy = target
	}
	if pairedCopy != "" {
		return pairedCopy, nil
	}
	return claim, nil
}

func cloudAgentCommerceValidatedSpecs(specs map[string]any) (size, quality string, duration int, err error) {
	for key, value := range specs {
		switch key {
		case "size":
			var ok bool
			if size, ok = value.(string); !ok {
				return "", "", 0, BadAuthRequest("电商交付项 specs.size 必须是字符串")
			}
		case "quality":
			var ok bool
			if quality, ok = value.(string); !ok {
				return "", "", 0, BadAuthRequest("电商交付项 specs.quality 必须是字符串")
			}
		case "durationSeconds":
			var seconds float64
			switch number := value.(type) {
			case float64:
				seconds = number
			case int:
				seconds = float64(number)
			default:
				return "", "", 0, BadAuthRequest("电商交付项 specs.durationSeconds 必须是整数")
			}
			if seconds < 0 || seconds > 120 || seconds != float64(int(seconds)) {
				return "", "", 0, BadAuthRequest("电商交付项 specs.durationSeconds 须为 0 至 120 的整数")
			}
			duration = int(seconds)
		default:
			return "", "", 0, BadAuthRequest("电商交付项 specs 含未知字段")
		}
	}
	return size, quality, duration, nil
}

func cloudAgentCommercePlanHash(plan *cloudAgentCommercePlan) string {
	raw, _ := json.Marshal(plan)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func cloudAgentCommerceItemKey(plan *cloudAgentCommercePlan, itemID string) string {
	return fmt.Sprintf("%s:%d:%s", plan.PlanID, plan.Version, itemID)
}

func cloudAgentCommerceTaskID(userID string, plan *cloudAgentCommercePlan, itemID string, sessionID ...string) string {
	key := "commerce:task:" + cloudAgentCommerceItemKey(plan, itemID)
	if len(sessionID) > 0 && sessionID[0] != "" {
		key = "commerce:session:" + sessionID[0] + ":" + key
	}
	return cloudAgentID(userID, key)
}

func cloudAgentCommerceDependenciesReady(repo *repository.Repository, userID string, state *cloudAgentRuntime, itemID string) error {
	if repo == nil || state == nil || state.CommercePlan == nil {
		return BadAuthRequest("电商计划依赖校验缺少运行状态")
	}
	var item *cloudAgentCommerceItem
	for i := range state.CommercePlan.Items {
		if state.CommercePlan.Items[i].ID == itemID {
			item = &state.CommercePlan.Items[i]
			break
		}
	}
	if item == nil {
		return BadAuthRequest("电商计划交付项不存在")
	}
	for _, dependencyID := range item.Dependencies {
		if !cloudAgentCommerceSuccessfulDependency(repo, userID, state, dependencyID) {
			return BadAuthRequest("依赖交付项尚未成功；请先查看原任务状态")
		}
	}
	return nil
}

// Compile the server-validated item into a normal generate_media call. Review
// translation is deliberately never copied into the render prompt.
func cloudAgentCommerceMediaCall(plan *cloudAgentCommercePlan, call cloudAgentCall) (cloudAgentCall, error) {
	if plan == nil {
		return call, BadAuthRequest("尚无已校验的电商计划")
	}
	if err := cloudAgentCommerceCheckReviewCopy(plan); err != nil {
		return call, err
	}
	var args struct {
		Mode              string `json:"mode"`
		PlanID            string `json:"commercePlanId"`
		ItemID            string `json:"commerceItemId"`
		RetryFailedTaskID string `json:"retryFailedTaskId"`
		RetryPrompt       string `json:"retryPrompt"`
	}
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		return call, cloudAgentJSONArgumentError(err)
	}
	if args.PlanID != plan.PlanID {
		return call, BadAuthRequest("电商计划 ID 与已确认版本不一致")
	}
	var item *cloudAgentCommerceItem
	for i := range plan.Items {
		if plan.Items[i].ID == args.ItemID {
			item = &plan.Items[i]
			break
		}
	}
	if item == nil || item.Type == "text" || args.Mode != item.Type {
		return call, BadAuthRequest("电商交付项不存在或媒体类型不匹配")
	}
	if args.RetryPrompt != "" {
		if args.RetryFailedTaskID == "" || item.Type != "image" || strings.TrimSpace(args.RetryPrompt) == "" || len([]rune(args.RetryPrompt)) > 16000 {
			return call, BadAuthRequest("修复提示词仅用于已确认失败的图片交付项，且须为有效的场景描述")
		}
		// Only this attempt's scene direction changes. The immutable plan still
		// supplies the style lock, product, copy, design, specs and references.
		copyPlan := *plan
		copyPlan.Items = append([]cloudAgentCommerceItem(nil), plan.Items...)
		for i := range copyPlan.Items {
			if copyPlan.Items[i].ID == args.ItemID {
				copyPlan.Items[i].Prompt = strings.TrimSpace(args.RetryPrompt)
				item = &copyPlan.Items[i]
			}
		}
		if err := cloudAgentCommerceCheckReviewCopy(&copyPlan); err != nil {
			return call, err
		}
	}
	size, quality, duration, err := cloudAgentCommerceValidatedSpecs(item.Specs)
	if err != nil {
		return call, err
	}
	language := firstNonEmpty(item.Language, plan.Language)
	prompt := fmt.Sprintf("Target market: platform: %s; site: %s; language: %s.\n", plan.Platform, plan.Site, language)
	if strings.TrimSpace(plan.StyleBible) != "" {
		prompt += "\nVisual direction:\n" + strings.TrimSpace(plan.StyleBible) + "\n"
	}
	if item.Type == "image" && item.Design != nil {
		design := *item.Design
		if plan.StyleLock != nil {
			// The set's reviewed typography/colors are the only rendering source.
			// Local layout descriptions cannot introduce a conflicting font/palette.
			design.Typography = "Use the shared set style lock; text placement follows the approved composition."
			design.Palette = "Use the shared set style lock for graphics; preserve natural product and photographic scene colors."
		}
		prompt += "\nApproved image design (layout instructions, not visible copy):\n" + cloudAgentCommerceDesignPrompt(&design)
	}
	if item.Type == "image" && size != "" {
		prompt += "\nOutput canvas: " + size + ". This is the image canvas, not the product's physical aspect ratio. Preserve the product's own proportions within this canvas."
	}
	prompt += "\nItem purpose: " + strings.TrimSpace(item.Purpose) + "\nItem direction:\n" + strings.TrimSpace(item.Prompt)
	if item.Type == "image" && plan.StyleLock != nil {
		prompt += "\n\n" + cloudAgentCommerceStyleLockPrompt(plan.StyleLock) + "\nThe shared style lock takes precedence over conflicting font/color directions in this item's scene description."
	}
	prompt += "\n\nPreserve the actual product's identity, silhouette, visible details and existing lawful brand marks. Do not add new logos, watermarks, marketplace marks or unverified certifications. Do not invent dimensions, materials, performance or features; use style and competitor references only for visual expression."
	if len(item.FactIDs) > 0 {
		prompt += "\n\nVerified product facts (context only; do not render as visible copy):"
		for _, id := range item.FactIDs {
			var fact *cloudAgentCommerceFact
			for i := range plan.ProductFacts {
				if plan.ProductFacts[i].ID == id {
					fact = &plan.ProductFacts[i]
					break
				}
			}
			if fact == nil {
				return call, BadAuthRequest("交付项引用了未锁定的产品事实")
			}
			claim, err := cloudAgentCommerceRenderFactClaim(plan, *fact)
			if err != nil {
				return call, err
			}
			prompt += "\n- " + fact.ID + ": " + claim
			prompt += " (sources: " + strings.Join(fact.SourceIDs, ", ") + ")"
		}
	}
	if rules := cloudAgentCommerceRules(plan.Platform, plan.Site); len(rules) > 0 {
		prompt += "\n\nVerified platform rules (reference only; do not render as visible copy):"
		for _, rule := range rules {
			prompt += fmt.Sprintf("\n- %s (source: %s; checked: %s)", rule.Text, rule.SourceURL, rule.CheckedAt)
		}
	}
	if strings.TrimSpace(item.TargetCopy) != "" {
		prompt += "\n\nTarget-language visible copy (render exactly these lines, no translations):\n" + item.TargetCopy
	} else {
		prompt += "\n\nNo visible text: do not render words, labels or captions."
	}
	mediaArgs := cloudAgentMediaArgs{Mode: item.Type, Prompt: prompt, Title: item.Title, AttachmentResourceIDs: item.AttachmentResourceIDs, References: plan.References, Size: size, Quality: quality, Duration: duration}
	raw, err := json.Marshal(mediaArgs)
	if err != nil {
		return call, err
	}
	call.Function.Arguments = string(raw)
	return call, nil
}

func cloudAgentCommercePlanItems(plan *cloudAgentCommercePlan) []map[string]any {
	items := make([]map[string]any, 0, len(plan.Items))
	for _, item := range plan.Items {
		items = append(items, map[string]any{"id": item.ID, "status": "pending", "title": item.Title, "type": item.Type, "targetCopy": item.TargetCopy, "zhReviewCopy": item.ChineseReviewCopy, "specs": item.Specs, "dependencies": item.Dependencies})
	}
	return items
}

func cloudAgentCommerceReviewPayload(plan *cloudAgentCommercePlan, req CloudAgentRequest, skills []cloudAgentSkill, journal ...[]CloudAgentEvent) map[string]any {
	references := make([]map[string]any, 0, len(req.Attachments))
	attachments, _ := cloudAgentCreationReferenceRoles(req, plan.References)
	usages := map[string]string{}
	for _, reference := range plan.References {
		usages[reference.ResourceID] = reference.Usage
	}
	counts := map[string]int{}
	for _, attachment := range attachments {
		counts[attachment.Kind]++
		references = append(references, map[string]any{"resourceId": attachment.ResourceID, "name": attachment.Name, "kind": attachment.Kind, "index": counts[attachment.Kind], "role": attachment.Role, "usage": usages[attachment.ResourceID]})
	}
	used := map[string]bool{}
	if len(journal) > 0 {
		for _, event := range journal[0] {
			if event.Type == "tool_completed" && stringValue(event.Payload["toolName"]) == "skill_read_file" {
				used[stringValue(event.Payload["skillId"])] = true
			}
		}
	}
	activeSkills := make([]map[string]any, 0, len(skills))
	for _, skill := range skills {
		if len(journal) > 0 && !used[skill.ID] {
			continue
		}
		activeSkills = append(activeSkills, map[string]any{"id": skill.ID, "name": skill.Name})
	}
	return map[string]any{
		"planId": plan.PlanID, "version": plan.Version, "planHash": cloudAgentCommercePlanHash(plan),
		"platform": plan.Platform, "site": plan.Site, "language": plan.Language,
		"plan": plan, "references": references, "skills": activeSkills,
		"items": cloudAgentCommercePlanItems(plan), "maxCredits": req.Budget.MaxCredits,
	}
}
