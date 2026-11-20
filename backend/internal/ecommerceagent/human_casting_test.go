package ecommerceagent

import (
	"strings"
	"testing"
)

func TestCastingMarketUsesDestinationBeforePlatformAndLanguage(t *testing.T) {
	for _, tc := range []struct {
		platform, region, language, market string
		overseas                           bool
	}{
		{"taobao", "", "en-US", "cn", false},
		{"amazon", "中国", "en-US", "cn", false},
		{"amazon", "日本", "en-US", "rakuten", true},
		{"taobao", "UAE", "zh-CN", "noon", true},
		{"amazon", "India", "en-US", "india", true},
		{"shopee", "", "en-US", "shopee", true},
		{"amazon", "", "ja-JP", "rakuten", true},
		{"amazon", "美国", "zh-CN", "international", true},
	} {
		market, overseas, _ := designCastingMarket(VariationInput{Platform: tc.platform, Region: tc.region, Language: tc.language})
		if market != tc.market || overseas != tc.overseas {
			t.Fatalf("%+v: %s %v", tc, market, overseas)
		}
	}
}

func TestCastingChangesFaceAndKeepsDestinationAndProductRole(t *testing.T) {
	in := VariationInput{ImageType: "detail", Platform: "amazon", Region: "Japan", Category: "maternal", Count: 9, PeopleAllowed: true}
	first := PickDesignVariation(designTestRand(3), in)
	in.Avoid = first.Picks
	second := PickDesignVariation(designTestRand(3), in)
	var previousFace string
	for _, v := range []DesignVariation{first, second} {
		if !strings.Contains(v.Persona, "日本都市面孔") || !strings.Contains(v.Persona, "本轮面貌识别点") {
			t.Fatal(v.Persona)
		}
		maternal, face := false, ""
		for _, id := range v.Picks {
			maternal = maternal || strings.HasPrefix(id, "h-ma-")
			if strings.HasPrefix(id, "face-") {
				face = id
			}
		}
		if !maternal || face == "" {
			t.Fatal(v.Picks)
		}
		if previousFace == face {
			t.Fatal("face repeated despite available alternatives")
		}
		previousFace = face
	}
}
