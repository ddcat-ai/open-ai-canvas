package app

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestEcommerceCreativeDirectionsAreDynamicAndStable(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	now := time.Now().UTC()
	source := model.EcommerceKnowledgeSource{ID: "test-source", Name: "Test vetted source", URL: "https://example.org/source", Repository: "test/source", Commit: "0123456789abcdef", License: "MIT", Status: "ready", LastSyncedAt: &now}
	if err := svc.repo.UpsertEcommerceKnowledgeSource(&source); err != nil {
		t.Fatal(err)
	}
	entry := model.EcommerceKnowledgeEntry{ID: "test-entry", SourceID: source.ID, KnowledgeType: "photography", Title: "商品摄影与真实外观", Category: "general", ContentJSON: `{"guidance":"以真实商品外观为准，使用不同机位和场景。"}`, PlatformsJSON: "[]", LanguagesJSON: "[]", TrustLevel: "community", ReviewStatus: "approved", DedupHash: "test-entry-hash", SourceURL: source.URL, SourceCommit: source.Commit, License: source.License}
	if err := svc.repo.UpsertEcommerceKnowledgeEntry(&entry); err != nil {
		t.Fatal(err)
	}
	techProject, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	tech, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{ProjectID: techProject.ID, ProductName: "蓝色头戴式耳机", Category: "3C 数码", Platform: "douyin", Language: "zh-CN", ImageType: "detail", Count: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(tech.Directions) != 4 {
		t.Fatalf("want exactly four directions, got %d", len(tech.Directions))
	}
	if tech.ProductCategory != "tech" {
		t.Fatalf("want tech category, got %q", tech.ProductCategory)
	}
	if len(tech.Evidence) < 4 {
		t.Fatalf("expected reviewed knowledge and first-party design evidence, got %d", len(tech.Evidence))
	}
	visual := false
	for _, evidence := range tech.Evidence {
		if evidence.TrustLevel == "first_party" && (evidence.KnowledgeDomain == "KB03" || evidence.KnowledgeDomain == "KB09") {
			visual = true
		}
	}
	if !visual {
		t.Fatal("first-party design knowledge missing from recommendation evidence")
	}
	selected, err := svc.SelectEcommerceCreativeDirection("user", tech.RecommendationID, tech.Directions[1].ID)
	if err != nil || selected.DirectionID != tech.Directions[1].ID || len(selected.PlanningContext) == 0 {
		t.Fatalf("direction selection lost persisted strategy: %#v, %v", selected, err)
	}
	if _, err := svc.SelectEcommerceCreativeDirection("other", tech.RecommendationID, tech.Directions[1].ID); err == nil {
		t.Fatal("recommendation crossed user boundary")
	}
	if _, err := svc.SelectEcommerceCreativeDirection("user", tech.RecommendationID, tech.Directions[0].ID); err == nil {
		t.Fatal("a selected direction was overwritten")
	}
	if _, err := svc.SyncEcommerceKnowledge(context.Background(), &model.User{ID: "user", Role: model.UserRoleUser}); err == nil {
		t.Fatal("ordinary user started a knowledge sync")
	}
	if err := svc.ReviewEcommerceKnowledgeEntry(&model.User{ID: "user", Role: model.UserRoleUser}, entry.ID, "rejected"); err == nil {
		t.Fatal("ordinary user reviewed knowledge")
	}
	if err := svc.SetEcommerceKnowledgeSourceEnabled(&model.User{ID: "user", Role: model.UserRoleUser}, source.ID, false); err == nil {
		t.Fatal("ordinary user disabled a knowledge source")
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if err := svc.SetEcommerceKnowledgeSourceEnabled(admin, source.ID, false); err != nil {
		t.Fatal(err)
	}
	blockedProject, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{ProjectID: blockedProject.ID, ProductName: "耳机", Platform: "douyin", Language: "zh-CN", Count: 3}); err == nil {
		t.Fatal("disabled source was still used by recommendations")
	}
	if err := svc.SetEcommerceKnowledgeSourceEnabled(admin, source.ID, true); err != nil {
		t.Fatal(err)
	}

	beautyProject, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	beauty, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{ProjectID: beautyProject.ID, ProductName: "清透洗面奶", Platform: "douyin", Language: "zh-CN", ImageType: "main", Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	if beauty.ProductCategory != "beauty" || beauty.Directions[0].Name == tech.Directions[0].Name {
		t.Fatalf("different categories reused the same direction set: tech=%q beauty=%q", tech.Directions[0].Name, beauty.Directions[0].Name)
	}
	phoneProject, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	phone, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{ProjectID: phoneProject.ID, ProductName: "新款智能手机", Platform: "douyin", Language: "zh-CN", ImageType: "set", Count: 3})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(directionNames(phone.Directions), "|") == strings.Join(directionNames(tech.Directions), "|") {
		t.Fatal("different tech products reused an identical direction set")
	}
}

func TestEcommerceCreativeDirectionsUseFirstPartyFallbackBeforeSourceSync(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	// A new local database has no imported source rows. Original, reviewed
	// application methods must still make the recommendation endpoint usable.
	response, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{
		ProjectID: project.ID, ProductName: "高端头戴式耳机", Category: "3C 数码", ImageType: "detail", Count: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Directions) != 4 || len(response.Evidence) == 0 {
		t.Fatalf("first-party fallback did not produce auditable directions: %#v", response)
	}
	var original int64
	if err := db.Model(&model.EcommerceCreativeRecommendation{}).Where("id = ?", response.RecommendationID).Count(&original).Error; err != nil || original != 1 {
		t.Fatalf("recommendation was not persisted: count=%d err=%v", original, err)
	}
	for _, evidence := range response.Evidence {
		if evidence.TrustLevel == "first_party" && evidence.KnowledgeDomain == "" {
			t.Fatalf("first-party evidence lacks KB domain: %#v", evidence)
		}
	}
}

func directionNames(directions []EcommerceCreativeDirection) []string {
	names := make([]string, 0, len(directions))
	for _, direction := range directions {
		names = append(names, direction.Name)
	}
	return names
}

func TestEcommerceScenarioDirectionsCoverCoreCategoriesAndKB01ToKB10(t *testing.T) {
	scenarios := []struct {
		name, category, product string
	}{
		{"maternal bottle", "maternal", "婴儿奶瓶"},
		{"premium headphones", "tech", "高端头戴式耳机"},
		{"women apparel", "apparel", "女士连衣裙"},
		{"smart appliance", "appliance", "智能扫地机器人"},
		{"home product", "home", "亚麻沙发"},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			directions := ecommercePickDirections(scenario.category, EcommerceCreativeDirectionsRequest{ProductName: scenario.product, ImageType: "detail"}, ecommerceOriginalVisualKnowledge(EcommerceCreativeDirectionsRequest{ProductName: scenario.product, ImageType: "detail"}))
			if len(directions) != 4 {
				t.Fatalf("want four directions, got %d", len(directions))
			}
			seen := map[string]bool{}
			for _, direction := range directions {
				if seen[direction.Name] || direction.Name == "" || direction.Summary == "" {
					t.Fatalf("directions are not distinct and complete: %#v", directions)
				}
				seen[direction.Name] = true
			}
		})
	}
	// KB01-KB10 ship with the binary and are bootstrapped into the database.
	domains := map[string]bool{}
	for _, entry := range ecommerceBuiltinKnowledgeEntries() {
		domains[entry.KnowledgeDomain] = true
	}
	for _, domain := range []string{"KB01", "KB02", "KB03", "KB04", "KB05", "KB06", "KB07", "KB08", "KB09", "KB10"} {
		if !domains[domain] {
			t.Fatalf("first-party knowledge has no seed for %s", domain)
		}
	}
}

func TestEcommerceBathroomDirectionsExploreOpenStateWithoutFabricatedParts(t *testing.T) {
	req := EcommerceCreativeDirectionsRequest{ProductName: "白色智能马桶", ImageType: "detail", Count: 4}
	if category := ecommerceProductCategory(req); category != "bathroom" {
		t.Fatalf("want bathroom category before generic smart device, got %q", category)
	}
	directions := ecommercePickDirections("bathroom", req, nil)
	if len(directions) != 4 {
		t.Fatalf("want four distinct visual directions, got %d", len(directions))
	}
	openState := false
	for _, direction := range directions {
		if !strings.HasSuffix(direction.Name, "风") || !strings.Contains(direction.Summary, "文案方向") {
			t.Fatalf("direction needs a named style and concrete copy angle: %#v", direction)
		}
		if strings.Contains(direction.Summary, "盖板打开") && strings.Contains(direction.Summary, "视觉提案") {
			openState = true
		}
	}
	if !openState {
		t.Fatal("closed toilet reference did not yield an open-lid visual exploration")
	}
}

func TestEcommerceDirectionsPrioritizeProductIdentityAndDistinctCopy(t *testing.T) {
	products := []struct {
		name, category, expectedStyle string
	}{
		{"蓝色头戴式耳机", "tech", "潮流穿搭风"},
		{"亚麻沙发", "home", "松弛客厅风"},
		{"玻璃精华液", "beauty", "水光留白风"},
		{"女士连衣裙", "apparel", "都会编辑风"},
	}
	for _, product := range products {
		req := EcommerceCreativeDirectionsRequest{ProductName: product.name, Description: "居家使用场景", Instruction: "自然光下拍摄", ImageType: "detail"}
		category := ecommerceProductCategory(req)
		if category != product.category {
			t.Fatalf("%s classified as %s; want %s", product.name, category, product.category)
		}
		directions := ecommercePickDirections(category, req, nil)
		if len(directions) != 4 {
			t.Fatalf("%s: want four directions, got %d", product.name, len(directions))
		}
		seen, found := map[string]bool{}, false
		for _, direction := range directions {
			if seen[direction.Name] || !strings.Contains(direction.Summary, "文案方向：") {
				t.Fatalf("%s: repetitive or incomplete direction: %#v", product.name, direction)
			}
			seen[direction.Name] = true
			found = found || direction.Name == product.expectedStyle
		}
		if !found {
			t.Fatalf("%s: product-specific style %q missing: %v", product.name, product.expectedStyle, directionNamesFromSeeds(directions))
		}
	}
}

func directionNamesFromSeeds(directions []ecommerceDirectionSeed) []string {
	names := make([]string, 0, len(directions))
	for _, direction := range directions {
		names = append(names, direction.Name)
	}
	return names
}

func TestEcommerceKnowledgeSearchFindsRelevantTaxonomyBeyondFirstPage(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	entries := make([]model.EcommerceKnowledgeEntry, 0, 101)
	for index := 0; index < 100; index++ {
		entries = append(entries, model.EcommerceKnowledgeEntry{ID: fmt.Sprintf("taxonomy-%03d", index), SourceID: "taxonomy", KnowledgeType: "product_knowledge", Title: fmt.Sprintf("A category %03d", index), Category: "tech", ContentJSON: `{}`, ReviewStatus: "approved", DedupHash: fmt.Sprintf("taxonomy-hash-%03d", index)})
	}
	entries = append(entries, model.EcommerceKnowledgeEntry{ID: "taxonomy-headphones", SourceID: "taxonomy", KnowledgeType: "product_knowledge", Title: "Audio > Headphones", Category: "tech", ContentJSON: `{}`, ReviewStatus: "approved", DedupHash: "taxonomy-headphones-hash"})
	expired := time.Now().UTC().Add(-time.Hour)
	entries = append(entries,
		model.EcommerceKnowledgeEntry{ID: "taxonomy-expired", SourceID: "taxonomy", KnowledgeType: "product_knowledge", Title: "Headphones outdated", Category: "tech", ContentJSON: `{}`, ReviewStatus: "approved", ValidUntil: &expired, DedupHash: "taxonomy-expired-hash"},
		model.EcommerceKnowledgeEntry{ID: "taxonomy-pending", SourceID: "taxonomy", KnowledgeType: "product_knowledge", Title: "Headphones unreviewed", Category: "tech", ContentJSON: `{}`, ReviewStatus: "pending", DedupHash: "taxonomy-pending-hash"},
	)
	if _, err := svc.repo.InsertEcommerceKnowledgeEntries(entries); err != nil {
		t.Fatal(err)
	}
	found, err := svc.repo.SearchEcommerceKnowledgeEntries("tech", "Headphones")
	if err != nil {
		t.Fatal(err)
	}
	matched := false
	for _, entry := range found {
		if entry.ID == "taxonomy-headphones" {
			matched = true
		}
		if entry.ID == "taxonomy-expired" || entry.ID == "taxonomy-pending" {
			t.Fatalf("unusable knowledge reached retrieval: %s", entry.ID)
		}
	}
	if !matched {
		t.Fatal("relevant taxonomy category was hidden behind the initial query limit")
	}
}

func TestEcommerceKnowledgeLiveSync(t *testing.T) {
	if os.Getenv("RUN_ECOMMERCE_KNOWLEDGE_SYNC") != "1" {
		t.Skip("explicit live read-only source sync")
	}
	svc, _, _, _ := ecommerceCreationTestService(t)
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	result, err := svc.SyncEcommerceKnowledge(context.Background(), actor)
	if err != nil {
		t.Fatal(err)
	}
	stats, err := svc.EcommerceKnowledgeStats()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("live sync: result=%v approved=%v pending=%v sources=%v", result, stats["approvedCount"], stats["pendingCount"], stats["sourceCount"])
	if len(result["failed"].([]string)) != 0 || stats["sourceCount"].(int) != len(commerceSourceSpecs) {
		t.Fatalf("source import incomplete: result=%v sources=%v", result, stats["sourceCount"])
	}
	if stats["approvedCount"].(int64) < 1000 {
		t.Fatalf("unexpectedly small source import: %v", stats)
	}
	second, err := svc.SyncEcommerceKnowledge(context.Background(), actor)
	if err != nil {
		t.Fatal(err)
	}
	if second["imported"].(int) != 0 || second["duplicates"].(int) != result["imported"].(int) {
		t.Fatalf("incremental dedup failed: first=%v second=%v", result, second)
	}
	for _, name := range []string{"蓝色头戴式耳机", "婴儿奶瓶", "清透洗面奶", "女士针织连衣裙"} {
		project, err := svc.CreateEcommerceProject("user")
		if err != nil {
			t.Fatal(err)
		}
		response, err := svc.RecommendEcommerceCreativeDirections("user", EcommerceCreativeDirectionsRequest{ProjectID: project.ID, ProductName: name, Platform: "douyin", Language: "zh-CN", ImageType: "set", Count: 3})
		if err != nil {
			t.Fatal(err)
		}
		if len(response.Directions) != 4 || len(response.Evidence) == 0 {
			t.Fatalf("invalid retrieval-driven recommendation for %s: %#v", name, response)
		}
		t.Logf("product=%s category=%s directions=%s, %s, %s, %s evidence=%d", name, response.ProductCategory, response.Directions[0].Name, response.Directions[1].Name, response.Directions[2].Name, response.Directions[3].Name, len(response.Evidence))
	}
}
