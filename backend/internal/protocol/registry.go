package protocol

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

type Registry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
	releases map[string][]ProviderRelease
}

type ProviderRelease struct {
	PluginID   string             `json:"pluginId"`
	Version    string             `json:"version"`
	SHA256     string             `json:"sha256"`
	Current    bool               `json:"current"`
	Selectable bool               `json:"-"`
	Registry   *Registry          `json:"-"`
	Workflows  []ManifestWorkflow `json:"-"`
}

func (r *Registry) RegisterRelease(pluginID, version, digest string, current, selectable bool, adapters []Adapter, workflows []ManifestWorkflow) error {
	isolated, err := NewRegistry(adapters...)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.releases == nil {
		r.releases = make(map[string][]ProviderRelease)
	}
	for _, adapter := range adapters {
		id := adapter.Metadata().ID
		for _, existing := range r.releases[id] {
			if existing.PluginID != pluginID || existing.Version == version {
				return fmt.Errorf("请求协议 %s 的插件或版本冲突", id)
			}
		}
		r.releases[id] = append(r.releases[id], ProviderRelease{PluginID: pluginID, Version: version, SHA256: digest, Current: current, Selectable: selectable, Registry: isolated, Workflows: workflows})
	}
	return nil
}

func (r *Registry) ReleaseProviderIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.releases))
	for id := range r.releases {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (r *Registry) Releases(id string) []ProviderRelease {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]ProviderRelease(nil), r.releases[id]...)
}

func (r *Registry) BoundRelease(id, digest string) (ProviderRelease, error) {
	for _, release := range r.Releases(id) {
		if release.SHA256 == digest {
			adapter, _ := release.Registry.Get(id)
			if !adapter.Metadata().Enabled {
				return ProviderRelease{}, fmt.Errorf("请求协议 %s 已停用", id)
			}
			return release, nil
		}
	}
	return ProviderRelease{}, fmt.Errorf("请求协议 %s 的已锁定发行包 %s 不可用，请核对原包", id, digest)
}

func NewRegistry(adapters ...Adapter) (*Registry, error) {
	r := &Registry{adapters: make(map[string]Adapter, len(adapters))}
	for _, adapter := range adapters {
		if err := r.Register(adapter); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func (r *Registry) Register(adapter Adapter) error {
	if adapter == nil {
		return fmt.Errorf("protocol adapter is nil")
	}
	metadata := adapter.Metadata()
	metadata.ID = strings.TrimSpace(metadata.ID)
	metadata.Version = strings.TrimSpace(metadata.Version)
	if metadata.ID == "" || metadata.Version == "" {
		return fmt.Errorf("protocol adapter metadata requires id and version")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.adapters[metadata.ID]; exists {
		return fmt.Errorf("protocol adapter %q is already registered", metadata.ID)
	}
	r.adapters[metadata.ID] = adapter
	return nil
}

// Unregister removes an installed protocol from the live registry. The caller
// owns persistence; the registry only represents the current plugin snapshot.
func (r *Registry) Unregister(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	id = strings.TrimSpace(id)
	if _, ok := r.adapters[id]; !ok {
		return false
	}
	delete(r.adapters, id)
	return true
}

func (r *Registry) RegisterManifest(data []byte) error {
	adapter, err := LoadManifest(data)
	if err != nil {
		return err
	}
	return r.Register(adapter)
}

func (r *Registry) Get(id string) (Adapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	adapter, ok := r.adapters[strings.TrimSpace(id)]
	return adapter, ok
}

func (r *Registry) Resolve(id string) (Adapter, bool) {
	if adapter, ok := r.Get(id); ok {
		return adapter, true
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, adapter := range r.adapters {
		for _, alias := range adapter.Metadata().LegacyAliases {
			if strings.TrimSpace(alias) == strings.TrimSpace(id) {
				return adapter, true
			}
		}
	}
	return nil, false
}

func (r *Registry) List(surface Surface, capability Capability, includeUnavailable bool) []Metadata {
	r.mu.RLock()
	items := make([]Metadata, 0, len(r.adapters))
	for _, adapter := range r.adapters {
		metadata := adapter.Metadata()
		if !includeUnavailable && (!metadata.Enabled || metadata.UnavailableReason != "") {
			continue
		}
		if capability != "" && !containsCapability(metadata.Categories, capability) {
			continue
		}
		if surface != "" && !containsSurface(metadata.Scopes, surface) {
			continue
		}
		items = append(items, metadata)
	}
	r.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func (r *Registry) IsCapability(id string, capability Capability) bool {
	adapter, ok := r.Resolve(id)
	if !ok {
		return false
	}
	metadata := adapter.Metadata()
	return metadata.Enabled && metadata.UnavailableReason == "" && containsCapability(metadata.Categories, capability)
}

func containsCapability(values []Capability, value Capability) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func containsSurface(values []Surface, value Surface) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
