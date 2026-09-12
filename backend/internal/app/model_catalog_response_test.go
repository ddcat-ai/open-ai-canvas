package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestModelCatalogResponseKeepsActiveEmptyCollection(t *testing.T) {
	channels := []PublicChannelCatalog{}
	payload, err := json.Marshal(ModelCatalogResponse{Source: ModelCatalogSourceSystem, Channels: &channels})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	body := string(payload)
	if !strings.Contains(body, `"channels":[]`) {
		t.Fatalf("active empty channel collection was omitted: %s", body)
	}
	if strings.Contains(body, `"models"`) {
		t.Fatalf("inactive model collection must stay omitted: %s", body)
	}
}
