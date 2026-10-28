// Package adapters provides minimal compatibility bridges between upstream contracts and SupDance domain rules.
package adapters

import (
	"fmt"
	"strings"

	"yingce/backend/internal/supdance/domain"
)

// SupportedAPIVersions lists the host plugin API versions compatible with SupDance extensions.
var SupportedAPIVersions = map[string]bool{
	"yingce.plugin/v1": true,
	"yingce.plugin/v2": true,
}

// CheckPluginManifestCompatibility verifies that a SupDance custom plugin manifest
// satisfies host API version constraints and does not collide with upstream plugin IDs.
func CheckPluginManifestCompatibility(pluginID, apiVersion string, upstreamIDs map[string]struct{}) error {
	if err := domain.ValidateCustomPluginID(pluginID); err != nil {
		return err
	}
	if !SupportedAPIVersions[strings.TrimSpace(apiVersion)] {
		return fmt.Errorf("unsupported plugin apiVersion %q", apiVersion)
	}
	if _, exists := upstreamIDs[strings.TrimSpace(pluginID)]; exists {
		return fmt.Errorf("plugin ID %q collides with an upstream plugin", pluginID)
	}
	return nil
}

// VerifyBaselineSchema checks that the running database schema version is at least
// the minimum schema baseline expected by the current SupDance release.
func VerifyBaselineSchema(currentSchema int) error {
	expected := domain.DefaultMetadata().SchemaBaseline
	if currentSchema < expected {
		return fmt.Errorf("database schema version %d is older than required SupDance baseline %d", currentSchema, expected)
	}
	return nil
}

// Registry tracks isolated SupDance custom routes and tables so they never collide with upstream.
type Registry struct {
	routes map[string]struct{}
	tables map[string]struct{}
}

// NewRegistry creates an empty SupDance isolation registry.
func NewRegistry() *Registry {
	return &Registry{
		routes: make(map[string]struct{}),
		tables: make(map[string]struct{}),
	}
}

// RegisterRoute validates and registers a SupDance custom HTTP route.
func (r *Registry) RegisterRoute(routePath string) error {
	if err := domain.ValidateCustomAPIRoute(routePath); err != nil {
		return err
	}
	trimmed := strings.TrimSpace(routePath)
	if _, exists := r.routes[trimmed]; exists {
		return fmt.Errorf("duplicate SupDance route %q", trimmed)
	}
	r.routes[trimmed] = struct{}{}
	return nil
}

// RegisterTable validates and registers a SupDance custom database table name.
func (r *Registry) RegisterTable(tableName string) error {
	if err := domain.ValidateCustomTableName(tableName); err != nil {
		return err
	}
	trimmed := strings.TrimSpace(strings.ToLower(tableName))
	if _, exists := r.tables[trimmed]; exists {
		return fmt.Errorf("duplicate SupDance table %q", trimmed)
	}
	r.tables[trimmed] = struct{}{}
	return nil
}
