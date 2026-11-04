package app

import (
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	mathrand "math/rand/v2"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"yingce/backend/internal/ecommerceagent"
)

// ecommerceDesignMemory remembers the last design variations drawn for a
// confirmed direction (or a project without one) and for a product, content
// type and style, so planning the same style again, in this project or a new
// one, draws different layouts, UI kit, typography and persona.
type ecommerceDesignMemory struct {
	mu    sync.Mutex
	order []string
	runs  map[string][][]string
	// layouts keeps the layout signatures of more runs than runs keeps entry
	// ids, so a product's next several sets never repeat one exact list.
	layouts map[string][]string
}

const (
	ecommerceDesignMemoryKeys = 512
	ecommerceDesignMemoryRuns = 3
	// ecommerceDesignLayoutRuns is how many recent layout lists of a key are
	// never drawn again.
	ecommerceDesignLayoutRuns = 8
)

var ecommerceDesignHistory = &ecommerceDesignMemory{runs: map[string][][]string{}, layouts: map[string][]string{}}

// recent returns the signatures and entry ids of the remembered runs and the
// remembered layout signatures.
func (m *ecommerceDesignMemory) recent(key string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var keys []string
	for _, run := range m.runs[key] {
		keys = append(keys, run...)
	}
	return append(keys, m.layouts[key]...)
}

// remember stores one run (signature and entry ids) and its layout
// signatures under key.
func (m *ecommerceDesignMemory) remember(key string, run []string, layouts ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.layouts == nil {
		m.layouts = map[string][]string{}
	}
	for i, existing := range m.order {
		if existing == key {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.order = append(m.order, key)
	if len(m.order) > ecommerceDesignMemoryKeys {
		delete(m.runs, m.order[0])
		delete(m.layouts, m.order[0])
		m.order = m.order[1:]
	}
	runs := append(m.runs[key], append([]string(nil), run...))
	if len(runs) > ecommerceDesignMemoryRuns {
		runs = runs[len(runs)-ecommerceDesignMemoryRuns:]
	}
	m.runs[key] = runs
	if len(layouts) > 0 {
		recent := append(m.layouts[key], layouts...)
		if len(recent) > ecommerceDesignLayoutRuns {
			recent = recent[len(recent)-ecommerceDesignLayoutRuns:]
		}
		m.layouts[key] = recent
	}
}

func ecommerceDesignMemoryKey(userID, projectID string, draft EcommerceDraft) string {
	if draft.CreativeRecommendationID != "" && draft.CreativeDirectionID != "" {
		return userID + "|" + draft.CreativeRecommendationID + "|" + draft.CreativeDirectionID
	}
	return userID + "|" + projectID
}

// ecommerceDesignProductMemoryKey keys the memory by user, product (primary
// product reference, else product name), content type and style, so a new
// project of the same product and style starts from the last runs instead of
// an empty history. It is "" when the product is unknown.
func ecommerceDesignProductMemoryKey(userID string, draft EcommerceDraft, styleLabel string) string {
	product := ""
	for _, ref := range draft.References {
		if ref.Role == "primary" && strings.TrimSpace(ref.ResourceID) != "" {
			product = "ref:" + strings.TrimSpace(ref.ResourceID)
			break
		}
	}
	if product == "" {
		if name := ecommerceDesignNormalize(draft.ProductName); name != "" {
			product = "name:" + name
		}
	}
	if product == "" {
		return ""
	}
	return userID + "|product|" + product + "|" + ecommerceDirectionsContentType(draft) + "|" + ecommerceDesignStyleKey(styleLabel)
}

// ecommerceDesignStyleKey normalizes a direction or style label: a label that
// names a style-library preset ("安静治愈·晨光") keys by the preset, others by
// their letters and digits.
func ecommerceDesignStyleKey(label string) string {
	if strings.TrimSpace(label) == "" {
		return ""
	}
	if preset, ok := ecommerceagent.MatchStylePreset(label); ok {
		return "preset:" + preset.Key
	}
	return ecommerceDesignNormalize(label)
}

func ecommerceDesignNormalize(text string) string {
	return strings.ToLower(strings.Join(strings.FieldsFunc(text, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	}), ""))
}

// ecommerceDirectionLabel names the confirmed style: the user's own style
// name, else the direction label, else the style the draft typed or picked.
func ecommerceDirectionLabel(strategy map[string]any, draft EcommerceDraft) string {
	if style, ok := strategy["userStyle"].(map[string]any); ok {
		if name := strings.TrimSpace(stringValue(style["name"])); name != "" {
			return name
		}
	}
	if direction, ok := strategy["direction"].(map[string]any); ok {
		if label := strings.TrimSpace(stringValue(direction["label"])); label != "" {
			return label
		}
	}
	if prompt := strings.TrimSpace(draft.StylePrompt); prompt != "" {
		return prompt
	}
	return draft.Style
}

// ecommerceVariantRequestPattern matches an instruction asking for a set,
// combination or several colours; ecommerceNegatedVariantPattern removes
// "不要组合" style negations first.
var (
	ecommerceVariantRequestPattern = regexp.MustCompile(`(?i)套装|组合|多色|多款|多件|多种颜色|多个颜色|全家福|件套|\d+\s*件装|[两二三四五六]件装|\bbundles?\b|\bmulti-?packs?\b|\bset of \d|\bmultiple colou?rs\b`)
	ecommerceNegatedVariantPattern = regexp.MustCompile(`(?i)(?:不要|不需要|不用|无需|不做|不是|没有|非|无|\bno\b|\bnot\b|\bwithout\b)\s*(?:套装|组合|多色|多款|多件|多种颜色|多个颜色|全家福|件套|\bbundles?\b|\bmulti-?packs?\b|\bmultiple colou?rs\b)`)
	ecommerceColorSeparators       = regexp.MustCompile(`[,，、/／;；|｜+＋&]|\s+(?:and|or)\s+|和|及|与|或`)
)

// ecommerceDraftMultiVariant reports a product with several real colours,
// SKUs or pieces: two or more SKUs, two or more colours in the colours field,
// or an instruction asking for a set, combination or several colours. Only
// then may the playbook draw 全家福, 多色陈列, SKU 阵列 or 款式目录 layouts.
func ecommerceDraftMultiVariant(draft EcommerceDraft) bool {
	if len(draft.Skus) >= 2 {
		return true
	}
	colors := 0
	for _, part := range ecommerceColorSeparators.Split(draft.Colors, -1) {
		if strings.TrimSpace(part) != "" {
			colors++
		}
	}
	if colors >= 2 {
		return true
	}
	for _, text := range []string{draft.Instruction, draft.Colors} {
		if ecommerceVariantRequestPattern.MatchString(ecommerceNegatedVariantPattern.ReplaceAllString(text, "")) {
			return true
		}
	}
	return false
}

// ecommerceDesignRand seeds every draw from crypto/rand and the clock, so two
// requests never share a sequence.
func ecommerceDesignRand() *mathrand.Rand {
	var seed [16]byte
	_, _ = cryptorand.Read(seed[:])
	now := uint64(time.Now().UnixNano())
	return mathrand.New(mathrand.NewPCG(binary.LittleEndian.Uint64(seed[:8])^now, binary.LittleEndian.Uint64(seed[8:])))
}

// ecommerceNoPeoplePattern matches an explicit request for images without
// people or models.
var ecommerceNoPeoplePattern = regexp.MustCompile(`(?i)(?:不要|不需要|不用|无需|禁止|去掉|不出现|不能出现|不得出现|避免出现|不加|不放)(?:任何)?(?:人物|模特|真人|人像|人脸|人(?:[，。、,.；;！!\s]|$))|无人物|无模特|无真人|纯商品|只拍商品|\bno (?:people|persons?|humans?|models?)\b|\bwithout (?:people|persons?|humans?|a model|models?)\b`)

// ecommercePeopleAllowed is false for product-only types and when the user asked
// for no people.
func ecommercePeopleAllowed(draft EcommerceDraft) bool {
	switch draft.ImageType {
	case "white", "three-view", "sku", "size", "package":
		return false
	}
	if draft.TypeOptions["people"] == "不出现人物" {
		return false
	}
	return !ecommerceNoPeoplePattern.MatchString(draft.Instruction + "\n" + draft.StylePrompt)
}

func ecommerceUserModelProvided(draft EcommerceDraft) bool {
	if !draft.ModelEnabled {
		return false
	}
	for _, ref := range draft.References {
		if ref.Role == "model" {
			return true
		}
	}
	return false
}

// ecommerceMainSecondarySplit reports the 主副图 quick type: a two-image set
// split into one main and one secondary image.
func ecommerceMainSecondarySplit(draft EcommerceDraft) bool {
	return ecommerceMainSecondary(draft.ImageType, draft.Count, draft.TypeOptions["distribution"])
}

func ecommerceMainSecondary(imageType string, count int, distribution string) bool {
	return imageType == "set" && count == 2 && strings.Contains(distribution, "主图") && strings.Contains(distribution, "副图")
}

// ecommerceDirectionsContentType names the content the four directions are for.
func ecommerceDirectionsContentType(draft EcommerceDraft) string {
	if ecommerceMainSecondarySplit(draft) {
		return "main-secondary"
	}
	return draft.ImageType
}

// ecommerceDirectionStyle names the confirmed direction (and a style the user
// typed), so the drawn UI kit and typography stay inside that style.
func ecommerceDirectionStyle(strategy map[string]any, draft EcommerceDraft) string {
	parts := []string{}
	if direction, ok := strategy["direction"].(map[string]any); ok {
		parts = append(parts, stringValue(direction["label"]), stringValue(direction["style"]))
	}
	if style, ok := strategy["userStyle"].(map[string]any); ok {
		parts = append(parts, stringValue(style["name"]), stringValue(style["description"]))
	}
	parts = append(parts, draft.StylePrompt)
	return strings.TrimSpace(strings.Join(parts, " "))
}

// ecommerceDesignVariationFor draws this planning run's layouts, UI kit,
// typography, persona and scenes, avoiding the recent runs of the same
// direction and of the same product, content type and style (styleLabel, see
// ecommerceDirectionLabel), and remembers the draw under both for the next run.
func ecommerceDesignVariationFor(userID, projectID string, draft EcommerceDraft, category, style, styleLabel string) ecommerceagent.DesignVariation {
	keys := []string{ecommerceDesignMemoryKey(userID, projectID, draft)}
	if product := ecommerceDesignProductMemoryKey(userID, draft, styleLabel); product != "" {
		keys = append(keys, product)
	}
	var avoid []string
	for _, key := range keys {
		avoid = append(avoid, ecommerceDesignHistory.recent(key)...)
	}
	noText := draft.NoText || draft.ImageType == "white" || draft.ImageType == "three-view" || draft.CloneOptions["copyMode"] == "none" || (draft.CreativeOptions != nil && draft.CreativeOptions.TextMode == "none")
	variation := ecommerceagent.PickDesignVariation(ecommerceDesignRand(), ecommerceagent.VariationInput{
		ImageType: draft.ImageType, Platform: draft.Platform, Category: category, Style: style,
		Region: draft.Region, Language: draft.Language,
		Distribution: draft.TypeOptions["distribution"], Purpose: draft.TypeOptions["purpose"],
		Count: draft.Count, NoText: noText, PeopleAllowed: ecommercePeopleAllowed(draft),
		MultiVariant: ecommerceDraftMultiVariant(draft),
		Avoid:        avoid,
	})
	for _, key := range keys {
		ecommerceDesignHistory.remember(key, append([]string{variation.Signature}, variation.Picks...), variation.LayoutSignature)
	}
	if variation.Persona != "" && ecommerceUserModelProvided(draft) {
		variation.Persona = "用户已上传模特参考图：人物身份、面孔、年龄与体型一律以参考图为准，下列设定只取造型、动作与互动方式——" + variation.Persona
	}
	return variation
}

// ecommerceDetailOutline returns the run's drawn page layouts when they cover
// every page, and the fixed outline otherwise (tasks queued before the
// playbook, or a count that changed).
func ecommerceDetailOutline(metadata map[string]any, count int) []string {
	var variation ecommerceagent.DesignVariation
	if raw, err := json.Marshal(metadata["ecommerceDesignVariation"]); err == nil && json.Unmarshal(raw, &variation) == nil {
		if outline := variation.DetailOutline(); len(outline) == count {
			return outline
		}
	}
	return ecommercePlanningOutline(count)
}
