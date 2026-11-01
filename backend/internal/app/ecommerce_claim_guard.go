package app

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// These conservative checks cover high-risk concrete claims. They are not a
// substitute for reviewing model-generated copy and cannot detect every claim.
// hard claims are advertising red lines (certification, health, medical and
// absolute safety promises); they are always removed unless the seller
// supplied them. Soft claims (material, capacity, function, specs) may be
// written by the Agent as inferred product-information copy and are listed
// for the seller to verify before publishing.
var ecommerceClaimPatterns = []struct {
	label   string
	pattern *regexp.Regexp
	hard    bool
}{
	{"具体材质", regexp.MustCompile(`(?i)真皮|真鳄鱼皮|纯金|不锈钢|\bleather\b|\bstainless\s+steel\b|\bsolid\s+gold\b`), false},
	{"认证", regexp.MustCompile(`(?i)(?:FDA|CE|FCC|RoHS|3C|CCC)\s*(?:认证|certified|approved|certification)|(?:通过|获得).{0,8}(?:认证|检测)|权威检测|国家认证`), true},
	{"防水或防护等级", regexp.MustCompile(`(?i)防水|\bwaterproof\b|\bwater[-\s]resistant\b|\bIPX?[0-9]{1,2}\b`), false},
	{"降噪功能", regexp.MustCompile(`(?i)主动降噪|自适应降噪|\bANC\b|active\s+noise\s+cancel(?:l)?ing`), false},
	{"健康或安全功效", regexp.MustCompile(`(?i)抗菌|抑菌|无毒|食品级|医用级|不含\s*BPA|\bBPA[-\s]*free\b|临床验证|防过敏|绝对安全|治疗|治愈|预防疾病`), true},
	// Structural design claims common in the category; written by the Agent
	// and listed for the seller to verify.
	{"未证实的功能", regexp.MustCompile(`(?i)防胀气|防漏|低延迟|低时延`), false},
	{"容量", regexp.MustCompile(`(?i)[0-9]+(?:\.[0-9]+)?\s*(?:ml\b|毫升|升|l\b)`), false},
	{"蓝牙版本", regexp.MustCompile(`(?i)(?:蓝牙|bluetooth)\s*(?:版本|v)?\s*[0-9]+(?:\.[0-9]+)?`), false},
	{"续航时长", regexp.MustCompile(`(?i)(?:续航|播放时长|待机)\s*(?:达|约|长达)?\s*[0-9]+(?:\.[0-9]+)?\s*(?:小时|hours?|h\b)|[0-9]+(?:\.[0-9]+)?\s*(?:小时|hours?|h\b)\s*(?:的)?(?:长)?续航`), false},
}

var ecommerceSpecificMaterial = regexp.MustCompile(`(?i)硅胶|聚丙烯|聚碳酸酯|玻璃|纯棉|聚酯|塑料|\bsilicone\b|\bpolypropylene\b|\bpolycarbonate\b`)

func ecommerceMaterialRefersToProduct(text string, start int) bool {
	prefix := text[:start]
	if at := strings.LastIndexAny(prefix, "，,。；;！？!?\n"); at >= 0 {
		_, size := utf8.DecodeRuneInString(prefix[at:])
		prefix = prefix[at+size:]
	}
	runes := []rune(prefix)
	if len(runes) > 24 {
		prefix = string(runes[len(runes)-24:])
	}
	prefix = strings.ToLower(prefix)
	for _, subject := range []string{"商品", "产品", "瓶身", "瓶体", "奶嘴", "瓶盖", "机身", "外壳", "面料", "product", "bottle", "nipple", "device", "body"} {
		if strings.Contains(prefix, subject) {
			return true
		}
	}
	return false
}

func normalizeEcommerceClaim(value string) string {
	return strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) && r != '\n' {
			return -1
		}
		return r
	}, value))
}

func ecommerceClaimIsNegated(text string, start int) bool {
	prefix := text[:start]
	if at := strings.LastIndexAny(prefix, "，,。；;！？!?\n"); at >= 0 {
		_, size := utf8.DecodeRuneInString(prefix[at:])
		prefix = prefix[at+size:]
	}
	for _, sep := range []string{"但是", "然而", "不过", "而是", "并且", "同时", "而且", "然后", "另外", "仍然", "但"} {
		if at := strings.LastIndex(prefix, sep); at >= 0 {
			prefix = prefix[at+len(sep):]
		}
	}
	runes := []rune(prefix)
	if len(runes) > 48 {
		prefix = string(runes[len(runes)-48:])
	}
	prefix = strings.ToLower(prefix)
	for _, negation := range []string{"禁止", "不得", "不要", "不应", "不可", "不允许", "切勿", "未确认", "未获得", "不宣称", "不支持", "不具备", "未配备", "不含有", "没有", "do not", "does not", "must not", "don't", "avoid", "never"} {
		if strings.Contains(prefix, negation) {
			return true
		}
	}
	trimmed := strings.TrimSpace(prefix)
	return strings.HasSuffix(trimmed, "不") || strings.HasSuffix(trimmed, "无") || strings.HasSuffix(trimmed, "without")
}

func ecommerceClaimHasEvidence(evidence, claim string) bool {
	if claim == "" {
		return false
	}
	for offset := 0; offset < len(evidence); {
		at := strings.Index(evidence[offset:], claim)
		if at < 0 {
			return false
		}
		at += offset
		if !ecommerceClaimIsNegated(evidence, at) {
			return true
		}
		offset = at + len(claim)
	}
	return false
}

// ecommerceUngroundedClaim locates one unsupported claim in a page field.
type ecommerceUngroundedClaim struct {
	field      int // 0 prompt, 1 copy, 2 verifiedClaims
	start, end int
	message    string
}

func ecommercePageEvidence(draft EcommerceDraft, page model.EcommercePlanTask) string {
	// The product name the seller typed (e.g. "防胀气奶瓶") is their own
	// statement; the free-form instruction is not, because it can also list
	// claims the seller asked to exclude.
	evidence := []string{draft.Claims, draft.Materials, draft.Specifications, draft.Description, draft.Dimensions, draft.Packaging, draft.ProductName}
	for _, sku := range draft.Skus {
		if sku.ID == page.SkuID && page.SkuID != "" {
			evidence = append(evidence, sku.Claims, sku.Spec, sku.Packaging)
		}
	}
	return normalizeEcommerceClaim(strings.Join(evidence, "\n"))
}

// findUngroundedEcommerceClaim applies the conservative claim checks field by
// field and returns the first positive claim the seller's data does not support.
func findUngroundedEcommerceClaim(draft EcommerceDraft, plan model.EcommercePlan, page model.EcommercePlanTask, index int) (ecommerceUngroundedClaim, bool) {
	return findEcommerceClaim(draft, plan, page, index, false)
}

// findEcommerceClaim returns the first claim the seller's data does not
// support. hardOnly limits the search to advertising red lines.
func findEcommerceClaim(draft EcommerceDraft, plan model.EcommercePlan, page model.EcommercePlanTask, index int, hardOnly bool) (ecommerceUngroundedClaim, bool) {
	verified := ecommercePageEvidence(draft, page)
	fields := []string{page.Prompt, page.Copy, page.VerifiedClaims}
	for field, text := range fields {
		for _, check := range ecommerceClaimPatterns {
			if hardOnly && !check.hard {
				continue
			}
			for _, loc := range check.pattern.FindAllStringIndex(text, -1) {
				if ecommerceClaimIsNegated(text, loc[0]) {
					continue
				}
				claim := normalizeEcommerceClaim(text[loc[0]:loc[1]])
				if claim != "" && !ecommerceClaimHasEvidence(verified, claim) {
					return ecommerceUngroundedClaim{field, loc[0], loc[1], fmt.Sprintf("第%d页含未经用户资料证实的%s，请修改策划后重新报价", index+1, check.label)}, true
				}
			}
		}
	}
	if hardOnly {
		return ecommerceUngroundedClaim{}, false
	}
	for field, text := range fields {
		for _, loc := range ecommerceSpecificMaterial.FindAllStringIndex(text, -1) {
			if ecommerceClaimIsNegated(text, loc[0]) || (field == 0 && !ecommerceMaterialRefersToProduct(text, loc[0])) {
				continue
			}
			if !ecommerceClaimHasEvidence(verified, normalizeEcommerceClaim(text[loc[0]:loc[1]])) {
				return ecommerceUngroundedClaim{field, loc[0], loc[1], fmt.Sprintf("第%d页含未经用户资料证实的具体材质，请修改策划后重新报价", index+1)}, true
			}
		}
	}
	for _, uncertain := range plan.UncertainFacts {
		value := strings.TrimSpace(uncertain)
		if len([]rune(value)) < 2 {
			continue
		}
		switch strings.ToLower(value) {
		case "材质", "材料", "容量", "规格", "认证", "功能", "性能", "参数", "material", "capacity", "certification", "specification", "function":
			// A missing category is not itself a positive claim. Concrete
			// assertions remain subject to the checks above.
			continue
		}
		for field, text := range fields {
			for offset := 0; offset < len(text); {
				at := strings.Index(text[offset:], value)
				if at < 0 {
					break
				}
				at += offset
				if !ecommerceClaimIsNegated(text, at) && !ecommerceClaimHasEvidence(verified, normalizeEcommerceClaim(value)) {
					return ecommerceUngroundedClaim{field, at, at + len(value), fmt.Sprintf("第%d页使用了待确认的商品信息，请修改策划后重新报价", index+1)}, true
				}
				offset = at + len(value)
			}
		}
	}
	return ecommerceUngroundedClaim{}, false
}

func validateEcommercePageClaims(draft EcommerceDraft, plan model.EcommercePlan, page model.EcommercePlanTask, index int) error {
	if found, ok := findUngroundedEcommerceClaim(draft, plan, page, index); ok {
		return BadAuthRequest(found.message)
	}
	return nil
}

// ecommerceUnverifiedClaimMarker separates the page prompt from the appended
// exclusion note; the web client checks claims only before this marker.
const ecommerceUnverifiedClaimMarker = "以下商品主张未经核实"

// groundEcommercePageClaims removes unsupported claims instead of rejecting
// the paid plan. A claim inside a copy line drops that line (the headline only
// loses the phrase), a claim in the prompt or verified claims loses the
// phrase. The removed claims are listed after the marker so the image model
// does not draw them. It returns the removed claims.
func groundEcommercePageClaims(draft EcommerceDraft, plan model.EcommercePlan, page *model.EcommercePlanTask, index int) []string {
	removed := []string{}
	if at := strings.Index(page.Prompt, ecommerceUnverifiedClaimMarker); at >= 0 {
		page.Prompt = strings.TrimSpace(page.Prompt[:at])
	}
	for attempts := 0; attempts < 40; attempts++ {
		found, ok := findEcommerceClaim(draft, plan, *page, index, true)
		if !ok {
			break
		}
		fields := []*string{&page.Prompt, &page.Copy, &page.VerifiedClaims}
		text := *fields[found.field]
		removed = append(removed, strings.TrimSpace(text[found.start:found.end]))
		if found.field == 1 {
			*fields[1] = ecommerceDropCopyClaim(text, found.start, found.end)
		} else {
			*fields[found.field] = text[:found.start] + text[found.end:]
		}
	}
	if len(removed) > 0 {
		page.Prompt = strings.TrimSpace(page.Prompt) + "\n" + ecommerceUnverifiedClaimMarker + "，不得写进画面文字或作为功能宣称：" + strings.Join(ecommerceUniqueStrings(removed), "、") + "。"
		page.NegativePrompt = strings.TrimSpace(page.NegativePrompt + "\n未经核实的宣称：" + strings.Join(ecommerceUniqueStrings(removed), "、"))
	}
	return removed
}

// ecommerceDropCopyClaim removes the copy line holding a claim, so a callout
// never prints half a sentence. The first line (the headline) and a copy that
// would become empty only lose the claim phrase.
func ecommerceDropCopyClaim(copy string, start, end int) string {
	lineStart := strings.LastIndex(copy[:start], "\n") + 1
	lineEnd := strings.Index(copy[end:], "\n")
	if lineEnd < 0 {
		lineEnd = len(copy)
	} else {
		lineEnd += end
	}
	after := ""
	if lineEnd < len(copy) {
		after = copy[lineEnd+1:]
	}
	result := strings.TrimRight(copy[:lineStart], "\n")
	if after != "" {
		if result != "" {
			result += "\n"
		}
		result += after
	}
	if lineStart == 0 || strings.TrimSpace(result) == "" {
		return strings.TrimSpace(copy[:start] + copy[end:])
	}
	return result
}

// ecommerceInferredClaims lists the soft claims (material, capacity, function,
// specs) on a page that the seller's data does not support. They stay in the
// page and are shown to the seller as items to verify before publishing.
func ecommerceInferredClaims(draft EcommerceDraft, page model.EcommercePlanTask) []string {
	verified := ecommercePageEvidence(draft, page)
	found := []string{}
	for _, text := range []string{page.Copy, page.VerifiedClaims} {
		for _, check := range ecommerceClaimPatterns {
			if check.hard {
				continue
			}
			for _, loc := range check.pattern.FindAllStringIndex(text, -1) {
				claim := strings.TrimSpace(text[loc[0]:loc[1]])
				if !ecommerceClaimIsNegated(text, loc[0]) && !ecommerceClaimHasEvidence(verified, normalizeEcommerceClaim(claim)) {
					found = append(found, claim)
				}
			}
		}
		for _, loc := range ecommerceSpecificMaterial.FindAllStringIndex(text, -1) {
			claim := strings.TrimSpace(text[loc[0]:loc[1]])
			if !ecommerceClaimIsNegated(text, loc[0]) && !ecommerceClaimHasEvidence(verified, normalizeEcommerceClaim(claim)) {
				found = append(found, claim)
			}
		}
	}
	return ecommerceUniqueStrings(found)
}

func ecommerceUniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
