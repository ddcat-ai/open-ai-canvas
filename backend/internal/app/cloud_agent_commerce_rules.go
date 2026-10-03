package app

import "strings"

// Only rules checked against accessible first-party pages are encoded here.
// An absent rule means unknown, not permission to assert compliance.
func cloudAgentCommerceRules(platform, site string) []cloudAgentCommerceRule {
	site = strings.ToUpper(strings.TrimSpace(site))
	switch platform {
	case "amazon":
		if site != "JP" {
			return nil
		}
		return []cloudAgentCommerceRule{{
			ID:        "amazon-jp-listing-primary-and-secondary-images-2026-10-03",
			Text:      "亚马逊日本站商品主图要求纯白背景（RGB 255,255,255）、商品约占画面 85% 且完整呈现；不含白底图的场景或细节设计应明确规划为副图，不得称其符合主图要求。所有商品图须准确呈现实际商品。",
			SourceURL: "https://sell.amazon.co.jp/en/learn/listing?mons_sel_locale=en_US",
			CheckedAt: "2026-10-03",
		}, {
			ID:        "amazon-jp-image-file-and-gallery-2026-10-03",
			Text:      "亚马逊日本站所有商品图最长边须为 500–10000 像素，清晰并准确呈现商品，支持 JPEG、TIFF、PNG 及非动画 GIF；副图可展示场景、细节和比较图。1:1 为本项目图库设计建议，不是该官方页面规定的唯一图片比例；主图白底与 85% 占比要求不套用为副图构图要求。",
			SourceURL: "https://sell.amazon.co.jp/en/learn/listing?mons_sel_locale=en_US",
			CheckedAt: "2026-10-03",
		}}
	case "tiktok_shop":
		if site != "US" {
			return nil
		}
		return []cloudAgentCommerceRule{
			{
				ID:        "tiktok-shop-us-product-images-2026-10-03",
				Text:      "TikTok Shop 美国站首图应清晰展示商品正面，不加文字、图形或水印；附加图可展示不同角度、特征及随附配件。商品图至少 600×600 像素，须与实际交付商品一致。",
				SourceURL: "https://seller-us.tiktok.com/university/course?content_id=7073362639816491&learning_id=7350062255294222",
				CheckedAt: "2026-10-03",
			},
			{
				ID:        "tiktok-shop-us-ai-product-accuracy-2026-10-03",
				Text:      "TikTok Shop 美国站允许准确反映真实商品的 AI 商品图；不得用 AI 改变商品尺寸、颜色、形状、特征、性能或实际套装内容。生成后仍须逐张人工核对。",
				SourceURL: "https://seller-us.tiktok.com/university/essay?knowledge_id=5892224899909383",
				CheckedAt: "2026-10-03",
			},
		}
	case "shopify":
		return []cloudAgentCommerceRule{{
			ID:        "shopify-product-media-image-types-2026-10-02",
			Text:      "Shopify 产品媒体支持图片；PNG 和 JPEG 是产品图片推荐文件类型。导出格式仍须与用户店铺及所选模型能力核对。",
			SourceURL: "https://help.shopify.com/en/manual/products/product-media/product-media-types",
			CheckedAt: "2026-10-02",
		}}
	default:
		return nil
	}
}
