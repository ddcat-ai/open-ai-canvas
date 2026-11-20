package ecommerceagent

import (
	"strings"
	"testing"
)

func TestDetailPlanningMethodProtectsEvidenceAndSeriesDirection(t *testing.T) {
	for _, want := range []string{"不能证实的推测", "固定九页", "长图逐屏参考模式", "已选方向", "人工核对", "用户决定是否重试", "主配色与辅助色", "焦段或镜头语言", "微距或近景特写至少两页", "纯色背景 + 简单几何圆形或色块 + 商品居中 + 小标题", "每一张允许文字的详情图都必须由 Agent 主动策划", "不同的说服角度", "不得伪造功能"} {
		if !strings.Contains(WorkbenchDetailPlanningMethod, want) {
			t.Errorf("detail method missing %q", want)
		}
	}
	if strings.Contains(CopyAndTypographyKnowledge, "九屏参考") {
		t.Fatal("fixed nine-page sequence returned")
	}
}

func TestDetailPlanningKnowledgeRequiresAgentPerformanceCopyAndVisualVariation(t *testing.T) {
	for _, want := range []string{"策划责任属于 Agent", "性能与优势的创作方法", "performanceAngle", "九张详情图", "至少两张围绕不同的功能/性能", "至少两张展示真实可见局部", "至少三张进入彼此不同", "成熟的画面信息组件", "Shopify Help", "TikTok Shop US", "Amazon Seller Central", "Etsy Seller Handbook"} {
		if !strings.Contains(EcommerceDetailKnowledge, want) {
			t.Errorf("detail knowledge missing %q", want)
		}
	}
	got := DetailPlanningKnowledge("淘宝", 9)
	if !strings.Contains(got, "目标平台：淘宝") || !strings.Contains(got, "详情页张数：9") {
		t.Fatalf("detail knowledge did not bind request context: %s", got)
	}
}
