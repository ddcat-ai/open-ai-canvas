package ecommerceagent

import (
	"regexp"
	"strings"
)

// Market selection precedes visual variation: a marketplace name alone does
// not identify its destination country, and domestic copy may be in English.
func designCastingMarket(in VariationInput) (string, bool, string) {
	in.Region = strings.TrimSpace(in.Region)
	markets := []struct{ pattern, platform, label string }{
		{`中国|国内|大陆|(?i)\b(china|cn)\b`, "cn", "中国国内：本土生活方式与自然中国人物，按商品受众选择妆发服饰，不默认网红脸"},
		{`日本|(?i)\b(japan|jp)\b`, "rakuten", "日本本地生活与人物风格"},
		{`韩国|(?i)\b(korea|kr)\b`, "coupang", "韩国本地生活与人物风格"},
		{`东南亚|新加坡|泰国|越南|印尼|马来|菲律宾|(?i)\b(southeast asia|singapore|thailand|vietnam|indonesia|malaysia|philippines)\b`, "shopee", "东南亚当地人物与生活场景"},
		{`中东|沙特|阿联酋|迪拜|(?i)\b(middle east|saudi|uae|dubai)\b`, "noon", "中东当地人物、穿着与生活场景，不机械添加文化符号"},
		{`俄罗斯|东欧|(?i)\b(russia|ru|eastern europe)\b`, "ozon", "俄罗斯或东欧当地人物与生活方式"},
		{`拉美|墨西哥|巴西|(?i)\b(latin america|mexico|brazil)\b`, "mercado-libre", "拉美当地人物与生活场景"},
		{`印度|南亚|(?i)\b(india|south asia)\b`, "india", "南亚当地人物与生活场景"},
	}
	for _, market := range markets {
		if regexp.MustCompile(market.pattern).MatchString(in.Region) {
			return market.platform, market.platform != "cn", market.label
		}
	}
	if in.Region != "" {
		return "international", true, "按用户明确的目标地区选择当地生活方式与人物；当地人群可以多元，不用单一肤色替代国籍，也不把国际市场默认画成中国棚拍模特"
	}
	if !crossBorderFamilies[platformFamily(in.Platform)] {
		return "cn", false, markets[0].label
	}
	if platformFamily(in.Platform) == "listing" || platformFamily(in.Platform) == "indie" {
		for prefix, market := range map[string]string{"ja": "rakuten", "ko": "coupang", "hi": "india", "ar": "noon", "ru": "ozon"} {
			if strings.HasPrefix(in.Language, prefix) {
				return market, true, "跨境选角：地区未指定，按目标语言对应市场选择当地生活方式与人物"
			}
		}
	}
	return platformKey(in.Platform), true, "跨境选角：优先平台实际销售地区；地区未指定时按目标语言市场做多元国际选角，不固定为同一欧美面孔"
}

var designFaceDetails = []designOption{
	opt("face-oval", "本轮面貌识别点：偏椭圆脸、自然平直眉、柔和下颌，眉眼与唇角轻微不对称"),
	opt("face-square", "本轮面貌识别点：偏方脸、清楚下颌转折、较浓自然眉、略宽鼻翼，保留自然左右差异"),
	opt("face-long", "本轮面貌识别点：略长脸、自然弧眉、偏窄下颌与清楚唇峰，不用统一尖下巴"),
	opt("face-round", "本轮面貌识别点：偏圆脸、柔和面颊、短下颌与自然眉峰，保留真实面部比例"),
	opt("face-angular", "本轮面貌识别点：颧骨轮廓清楚、自然眉毛走向、平缓唇线与轻微鼻梁起伏"),
	opt("face-soft", "本轮面貌识别点：柔和宽额、略圆下颌、自然眉间距与不完全对称的笑纹"),
}
