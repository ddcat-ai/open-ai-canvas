package database

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm/schema"
)

func TestAssetIDColumnsUseSharedLimit(t *testing.T) {
	tests := []struct {
		value any
		field string
	}{
		{value: &model.Asset{}, field: "ID"},
		{value: &model.ProjectAssetLink{}, field: "AssetID"},
		{value: &model.ProjectAssetCandidate{}, field: "ResolvedAssetID"},
		{value: &model.AssetVersion{}, field: "AssetID"},
	}

	for _, test := range tests {
		parsed, err := schema.Parse(test.value, &sync.Map{}, schema.NamingStrategy{})
		if err != nil {
			t.Fatalf("parse schema: %v", err)
		}
		field := parsed.LookUpField(test.field)
		if field == nil {
			t.Fatalf("field %s not found in %s", test.field, parsed.Table)
		}
		if field.Size != model.AssetIDMaxLength {
			t.Fatalf("%s.%s size = %d, want %d", parsed.Table, field.DBName, field.Size, model.AssetIDMaxLength)
		}
	}
}

func TestPostgresAssetIDMigrationsCoverEveryAssetIDColumn(t *testing.T) {
	want := map[string]bool{
		"assets.id":                                  false,
		"project_asset_links.asset_id":               false,
		"project_asset_candidates.resolved_asset_id": false,
		"asset_versions.asset_id":                    false,
	}
	for _, migration := range assetIDColumnMigrations {
		key := migration.table + "." + migration.column
		if _, exists := want[key]; !exists {
			t.Fatalf("unexpected asset ID migration %s", key)
		}
		if !strings.Contains(migration.statement, fmt.Sprintf("varchar(%d)", model.AssetIDMaxLength)) {
			t.Fatalf("asset ID migration %s does not use limit %d", key, model.AssetIDMaxLength)
		}
		want[key] = true
	}
	for key, covered := range want {
		if !covered {
			t.Fatalf("missing asset ID migration %s", key)
		}
	}
}
