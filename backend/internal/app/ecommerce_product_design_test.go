package app

import "testing"

func TestProductKnowledgeNewDomainsAreStoredRetrievedAndPreserveReview(t *testing.T) {
	svc, _ := knowledgeTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	query := EcommerceCreativeDirectionsRequest{Category: "榨汁机", ProductName: "便携榨汁机", ImageType: "detail", Language: "zh-CN"}
	result, err := svc.retrieveEcommerceKnowledge(query)
	if err != nil {
		t.Fatal(err)
	}
	if result.Category != "appliance" {
		t.Fatalf("wrong category %s", result.Category)
	}
	domains := map[string]bool{}
	for _, row := range result.Selected {
		domains[row.KnowledgeDomain] = true
	}
	for _, id := range []string{"KB11", "KB12", "KB13", "KB14"} {
		if !domains[id] {
			t.Fatalf("new domain not retrieved %s", id)
		}
	}
	if err := svc.repo.ReviewEcommerceKnowledgeEntry("kb13-juicer-design", "rejected"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	entry, err := svc.repo.EcommerceKnowledgeEntryByID("kb13-juicer-design")
	if err != nil || entry.ReviewStatus != "rejected" {
		t.Fatalf("review overwritten: %+v %v", entry, err)
	}
}
