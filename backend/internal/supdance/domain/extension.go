// Package domain defines isolated SupDance domain contracts and metadata.
// It must never import yingce/backend/internal/app or yingce/backend/internal/service.
package domain

import (
	"fmt"
	"strings"
)

const (
	// TableNamespacePrefix enforces table-name isolation for any future SupDance custom tables.
	TableNamespacePrefix = "supdance_"
	// PluginIDPrefix enforces ID isolation for SupDance custom plugins.
	PluginIDPrefix = "supdance-"
	// APINamespacePrefix enforces route prefix isolation for SupDance custom HTTP endpoints.
	APINamespacePrefix = "/api/v1/supdance/"
)

// ExtensionMetadata describes the current SupDance extension runtime baseline.
type ExtensionMetadata struct {
	Namespace        string   `json:"namespace"`
	UpstreamBaseline string   `json:"upstreamBaseline"`
	SchemaBaseline   int      `json:"schemaBaseline"`
	Features         []string `json:"features"`
}

// DefaultMetadata returns the verified baseline metadata for SupDance Canvas.
func DefaultMetadata() ExtensionMetadata {
	return ExtensionMetadata{
		Namespace:        "supdance",
		UpstreamBaseline: "v1.7.1",
		SchemaBaseline:   71,
		Features: []string{
			"codex-agent-connector",
			"supdance-studio-theme",
			"supdance-plugin-isolation",
		},
	}
}

// ValidateCustomTableName ensures any custom database table created by SupDance
// uses the supdance_ prefix so it never collides with upstream GORM models or migrations.
func ValidateCustomTableName(tableName string) error {
	trimmed := strings.TrimSpace(strings.ToLower(tableName))
	if trimmed == "" {
		return fmt.Errorf("table name cannot be empty")
	}
	if !strings.HasPrefix(trimmed, TableNamespacePrefix) {
		return fmt.Errorf("custom table %q must start with prefix %q", tableName, TableNamespacePrefix)
	}
	if trimmed == TableNamespacePrefix {
		return fmt.Errorf("custom table %q must have a name after prefix %q", tableName, TableNamespacePrefix)
	}
	return nil
}

// ValidateCustomPluginID ensures any SupDance custom plugin uses the supdance- prefix.
func ValidateCustomPluginID(pluginID string) error {
	trimmed := strings.TrimSpace(pluginID)
	if !strings.HasPrefix(trimmed, PluginIDPrefix) || len(trimmed) <= len(PluginIDPrefix) {
		return fmt.Errorf("custom plugin ID %q must start with prefix %q", pluginID, PluginIDPrefix)
	}
	return nil
}

// ValidateCustomAPIRoute ensures any SupDance custom HTTP route uses the /api/v1/supdance/ prefix.
func ValidateCustomAPIRoute(routePath string) error {
	trimmed := strings.TrimSpace(routePath)
	if !strings.HasPrefix(trimmed, APINamespacePrefix) || len(trimmed) <= len(APINamespacePrefix) {
		return fmt.Errorf("custom API route %q must start with prefix %q", routePath, APINamespacePrefix)
	}
	return nil
}
