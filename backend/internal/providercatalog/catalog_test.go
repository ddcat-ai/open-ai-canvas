package providercatalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const sampleCatalog = `{
  "schemaVersion": 1,
  "tags": [{"id":"relay","label":"中转站","tone":"violet"},{"id":"bad tag","label":"x"}],
  "providers": [
    {"id":"acme","name":"Acme","tags":["relay","unknown"],"logo":"/v1/logos/acme.svg","rank":20,
     "startsAt":"2025-06-01T00:00:00+08:00","endsAt":"2025-07-01T00:00:00+08:00",
     "connection":{"baseUrl":"https://api.acme.example/v1/"},
     "keyGuide":{"url":"https://acme.example/reg","steps":["a","b"],"keyPattern":"^sk-"},
     "models":[
       {"modelKey":"m1","displayName":"M1","capability":"video","protocol":"newapi","priceTiers":[{"billingMode":"fixed_request","cost":1.2}]},
       {"modelKey":"m2","capability":"text","protocol":"chat-completion","priceTiers":[{"billingMode":"token","inputPerMillion":2,"outputPerMillion":8}]},
       {"modelKey":"m3","capability":"text","protocol":"chat-completion","priceTiers":[{"cost":1}]},
       {"modelKey":"m4","capability":"text","protocol":"chat-completion","priceTiers":[{"cost":1}]},
       {"modelKey":"m5","capability":"text","protocol":"chat-completion","priceTiers":[{"cost":1}]},
       {"modelKey":"m6","capability":"text","protocol":"chat-completion","priceTiers":[{"cost":1}]}
     ]},
    {"id":"early","name":"Early","rank":10,"startsAt":"2025-06-10T00:00:00Z","endsAt":"2025-06-20T00:00:00Z",
     "connection":{"baseUrl":"https://early.example/v1"},
     "models":[{"modelKey":"x","capability":"image","protocol":"openai-image","priceTiers":[{"cost":0.2}]}]},
    {"id":"insecure","name":"Insecure","startsAt":"2025-01-01T00:00:00Z","endsAt":"2026-01-01T00:00:00Z",
     "connection":{"baseUrl":"http://plain.example/v1"},
     "models":[{"modelKey":"x","capability":"image","protocol":"openai-image","priceTiers":[{"cost":0.2}]}]}
  ]
}`

func TestParseNormalizesAndDropsInvalidEntries(t *testing.T) {
	catalog, warnings, err := Parse([]byte(sampleCatalog), "https://ai.yingce.tv")
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Providers) != 2 {
		t.Fatalf("providers = %d, want 2 (http provider dropped)", len(catalog.Providers))
	}
	acme := catalog.Providers[0]
	if acme.Connection.BaseURL != "https://api.acme.example/v1" {
		t.Fatalf("connection = %#v", acme.Connection)
	}
	if acme.Logo != "https://ai.yingce.tv/v1/logos/acme.svg" {
		t.Fatalf("logo = %q", acme.Logo)
	}
	if len(acme.Models) != 6 {
		t.Fatalf("models = %d, want all 6", len(acme.Models))
	}
	if len(acme.Tags) != 1 || acme.Tags[0] != "relay" {
		t.Fatalf("tags = %#v", acme.Tags)
	}
	if acme.Models[1].DisplayName != "m2" || acme.Models[1].ProviderModelKey != "m2" {
		t.Fatalf("model defaults = %#v", acme.Models[1])
	}
	if len(warnings) == 0 {
		t.Fatal("expected warnings for dropped entries")
	}
}

func TestParseRecommendedModelLimitPerProvider(t *testing.T) {
	for _, count := range []int{5, 6, 99, 100, 101} {
		t.Run(fmt.Sprintf("%d models", count), func(t *testing.T) {
			var raw Catalog
			if err := json.Unmarshal([]byte(sampleCatalog), &raw); err != nil {
				t.Fatal(err)
			}
			raw.Tags = raw.Tags[:1]
			raw.Providers = raw.Providers[:2]
			for index := range raw.Providers {
				provider := &raw.Providers[index]
				provider.Models = make([]Model, count)
				for modelIndex := range provider.Models {
					provider.Models[modelIndex] = Model{
						ModelKey: fmt.Sprintf("model-%03d", modelIndex+1), Capability: "text", Protocol: "chat-completion",
						PriceTiers: []PriceTier{{BillingMode: "token", InputPerMillion: 2, OutputPerMillion: 8}},
					}
				}
			}
			body, err := json.Marshal(raw)
			if err != nil {
				t.Fatal(err)
			}
			catalog, warnings, err := Parse(body, "https://ai.yingce.tv")
			if err != nil {
				t.Fatal(err)
			}
			if len(catalog.Providers) != 2 {
				t.Fatalf("providers = %d, want 2", len(catalog.Providers))
			}
			wantCount := min(count, 100)
			for _, provider := range catalog.Providers {
				if len(provider.Models) != wantCount {
					t.Fatalf("%s models = %d, want %d", provider.ID, len(provider.Models), wantCount)
				}
				for index, item := range provider.Models {
					if want := fmt.Sprintf("model-%03d", index+1); item.ModelKey != want {
						t.Fatalf("%s model %d = %q, want %q", provider.ID, index, item.ModelKey, want)
					}
				}
				if count > 100 && !contains(warnings, provider.ID+"：推荐模型超过 100 个，其余已忽略") {
					t.Fatalf("missing overflow warning for %s: %v", provider.ID, warnings)
				}
			}
			wantWarnings := 0
			if count > 100 {
				wantWarnings = 2
			}
			if len(warnings) != wantWarnings {
				t.Fatalf("warnings = %v, want %d", warnings, wantWarnings)
			}
		})
	}
}

func TestParseRejectsWrongSchema(t *testing.T) {
	if _, _, err := Parse([]byte(`{"schemaVersion":2}`), ""); err == nil {
		t.Fatal("expected schema error")
	}
	if _, _, err := Parse([]byte(`not json`), ""); err == nil {
		t.Fatal("expected json error")
	}
}

func TestActiveFiltersByWindowAndSortsByRank(t *testing.T) {
	catalog, _, err := Parse([]byte(sampleCatalog), "")
	if err != nil {
		t.Fatal(err)
	}
	inBoth := time.Date(2025, 6, 15, 0, 0, 0, 0, time.UTC)
	active := catalog.Active(inBoth)
	if len(active) != 2 || active[0].ID != "early" || active[1].ID != "acme" {
		t.Fatalf("active = %#v", ids(active))
	}
	afterEarly := time.Date(2025, 6, 20, 0, 0, 0, 0, time.UTC)
	if got := ids(catalog.Active(afterEarly)); len(got) != 1 || got[0] != "acme" {
		t.Fatalf("endsAt must be exclusive, got %v", got)
	}
	if _, ok := catalog.FindActive("acme", time.Date(2025, 8, 1, 0, 0, 0, 0, time.UTC)); ok {
		t.Fatal("expired provider must not be active")
	}
}

func TestPricingAppliesMarkupWithCeil(t *testing.T) {
	bp, err := MarkupBasisPoints(30)
	if err != nil || bp != 3000 {
		t.Fatalf("bp = %d, %v", bp, err)
	}
	if got := ApplyMarkup(1_200_000, bp); got != 1_560_000 {
		t.Fatalf("sale = %d", got)
	}
	if got := ApplyMarkup(1, bp); got != 2 {
		t.Fatalf("sale must round up, got %d", got)
	}
	if _, err := MarkupBasisPoints(1000.01); err == nil {
		t.Fatal("markup above limit must fail")
	}
	if _, err := MarkupBasisPoints(10.001); err == nil {
		t.Fatal("more than two decimals must fail")
	}
	video := PriceFor("video", PriceTier{BillingMode: "token", InputPerMillion: 1, OutputPerMillion: 10, CachedPerMillion: 1}, 0)
	if video.CostInput != 0 || video.CostCached != 0 || video.CostOutput != 10_000_000 {
		t.Fatalf("video token cost = %#v", video)
	}
	text := PriceFor("text", PriceTier{BillingMode: "token", InputPerMillion: 2, OutputPerMillion: 8}, 5000)
	if text.SaleInput != 3_000_000 || text.SaleOutput != 12_000_000 {
		t.Fatalf("text token sale = %#v", text)
	}
}

func TestSourceFallsBackToPersistedSnapshot(t *testing.T) {
	fail := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			http.Error(w, "down", http.StatusBadGateway)
			return
		}
		if r.Header.Get("If-None-Match") == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		_, _ = w.Write([]byte(sampleCatalog))
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "catalog.json")
	now := time.Date(2025, 6, 15, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	source := NewSourceForTest(server.URL, "", server.Client(), path, clock)
	snapshot := source.Refresh(context.Background())
	if snapshot.State != SourceLive || snapshot.Catalog == nil || snapshot.ETag != `"v1"` {
		t.Fatalf("first refresh = %#v", snapshot)
	}
	if again := source.Refresh(context.Background()); again.State != SourceLive || again.Catalog == nil {
		t.Fatalf("304 refresh = %#v", again)
	}
	fail = true
	restarted := NewSourceForTest(server.URL, "", server.Client(), path, clock)
	cached := restarted.Refresh(context.Background())
	if cached.State != SourceCache || cached.Catalog == nil || !strings.Contains(cached.LastError, "502") {
		t.Fatalf("fallback = %#v", cached)
	}
	empty := NewSourceForTest(server.URL, "", server.Client(), filepath.Join(t.TempDir(), "none.json"), clock)
	if got := empty.Refresh(context.Background()); got.State != SourceUnavailable || got.Catalog != nil {
		t.Fatalf("no snapshot = %#v", got)
	}
}

func ids(providers []Provider) []string {
	result := make([]string, 0, len(providers))
	for _, provider := range providers {
		result = append(result, provider.ID)
	}
	return result
}
