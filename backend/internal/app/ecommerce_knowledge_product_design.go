package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

// Original editorial methods, scoped to categories; these are not SKU claims.
func ecommerceProductDesignKnowledge() []model.EcommerceKnowledgeEntry {
	var entries []model.EcommerceKnowledgeEntry
	for _, profile := range ecommerceagent.ProductDesignProfiles {
		presets := ecommerceagent.ProductStyleLibrary(profile.Subject)
		var typography []string
		for _, preset := range presets[:6] {
			typography = append(typography, preset.Label+"："+preset.Visual.Typography+"；"+preset.Visual.Graphics)
		}
		for _, spec := range []struct{ domain, kind, title, guidance string }{
			{"KB11", "scene_pattern", "品类九屏叙事", "场景：" + profile.Scene + "；道具：" + profile.Props + "；购买问题顺序候选：" + profile.Story + "。按实际证据和张数调整，不要求无资料也填参数页。"},
			{"KB12", "layout_pattern", "字体与信息组件", strings.Join(typography, "\n") + "。同一套统一字体家族；中文标题需中文字符覆盖，英文装饰字体不能替代中文字体。字号在手机端可读，相邻屏更换信息组件，纯图不得加字。"},
			{"KB13", "scene_pattern", "人物与产品接触摄影", ecommerceagent.HumanPhotographyKnowledge + "本品类场景：" + profile.Scene + "；互动细节：" + profile.Details},
			{"KB14", "copy_rule", "功能与规格成品文案", "围绕" + profile.Subject + "，用已确认的用途、实际操作、购买利益写主标题、说明与2–4个独立卖点，不要求用户提供广告文案。可见证据：" + profile.Details + "。功能与尺寸可以直接说明，但数值与单位必须来自卖家资料或清晰可辨的商品标识；不能按同品类常见值猜容量、功率、续航、尺寸或材质。区分整机和包装尺寸，未确认不填数字，不虚构对比实验。"},
		} {
			content, _ := json.Marshal(map[string]string{"guidance": spec.guidance, "domain": spec.domain, "scope": "original creative methods; not product specifications"})
			entries = append(entries, model.EcommerceKnowledgeEntry{ID: strings.ToLower(spec.domain) + "-" + profile.Key + "-design", SourceID: ecommerceBuiltinSourceID(spec.domain), KnowledgeDomain: spec.domain, KnowledgeType: spec.kind, Title: profile.Subject + " · " + spec.title, ContentJSON: string(content), Category: profile.Category, TagsJSON: mustProductDesignTags(profile.Terms), SourceURL: "builtin://meiyeai/" + strings.ToLower(spec.domain) + "-product-design", Version: strings.ToLower(spec.domain) + "-v1-20261101", License: "MeiYeAI Original", TrustLevel: "first_party", ReviewStatus: "approved"})
		}
	}
	return entries
}

func mustProductDesignTags(terms []string) string {
	if terms == nil {
		return "[]"
	}
	raw, _ := json.Marshal(terms)
	return string(raw)
}
