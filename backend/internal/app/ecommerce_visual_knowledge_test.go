package app

import "testing"

func TestEcommerceVisualKnowledgeRespectsTypeAndStyle(t *testing.T) {
	white := ecommerceOriginalVisualKnowledge(EcommerceCreativeDirectionsRequest{ImageType: "white", StylePrompt: "清新治愈", ReferenceMode: "style"})
	seen := map[string]bool{}
	for _, entry := range white {
		if entry.KnowledgeDomain == "" {
			t.Fatalf("original knowledge %s has no KB domain", entry.ID)
		}
		seen[entry.ID] = true
	}
	for _, id := range []string{"meiye-type-white", "meiye-style-healing", "meiye-reference-analysis", "meiye-style-custom"} {
		if !seen[id] {
			t.Fatalf("missing applicable knowledge %s", id)
		}
	}
	if seen["meiye-type-marketing"] {
		t.Fatal("marketing guidance leaked into white-background planning")
	}
	marketing := ecommerceOriginalVisualKnowledge(EcommerceCreativeDirectionsRequest{ImageType: "marketing", MaterialPlan: `[ {"id":"market-poster","count":1,"ratio":"3:4"} ]`})
	found := false
	for _, entry := range marketing {
		found = found || entry.ID == "meiye-type-marketing"
	}
	if !found {
		t.Fatal("marketing guidance missing")
	}
}

// 主副图 (a two-image set of 主图 + 副图) reads the main-image card, through
// every request the server derives from the draft; a product set keeps the
// set card.
func TestEcommerceMainSecondaryReadsTheMainImageCard(t *testing.T) {
	cards := func(req EcommerceCreativeDirectionsRequest) map[string]bool {
		seen := map[string]bool{}
		for _, entry := range ecommerceOriginalVisualKnowledge(req) {
			seen[entry.ID] = true
		}
		return seen
	}
	pair := EcommerceDraft{ImageType: "set", Count: 2, Platform: "amazon", TypeOptions: map[string]string{"distribution": "主图 1 张、副图 1 张"}}
	for name, req := range map[string]EcommerceCreativeDirectionsRequest{"planning": ecommerceDraftKnowledgeRequest(pair), "directions": ecommerceWorkbenchDirectionsRequest("project", pair)} {
		if got := cards(req); !got["meiye-type-main"] || got["meiye-type-set"] {
			t.Fatalf("%s request for 主副图 read the wrong type card: %v", name, got)
		}
		if kind := ecommerceKnowledgeContentType(req); kind != "main" {
			t.Fatalf("%s request content type = %s", name, kind)
		}
	}
	set := pair
	set.Count = 8
	if got := cards(ecommerceDraftKnowledgeRequest(set)); !got["meiye-type-set"] || got["meiye-type-main"] {
		t.Fatalf("an eight-image product set lost the set card: %v", got)
	}
	// The split is server-side only: it never enters the request JSON that
	// signs a recommendation.
	if raw := ecommerceRecommendationSignature(ecommerceWorkbenchDirectionsRequest("project", pair)); raw != ecommerceRecommendationSignature(EcommerceCreativeDirectionsRequest{ProjectID: "project", Platform: "amazon", ImageType: "set", Count: 2}) {
		t.Fatal("the distribution changed the recommendation signature")
	}
}
