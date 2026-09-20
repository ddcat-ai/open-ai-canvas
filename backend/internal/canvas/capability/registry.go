package capability

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const SetVersion = "canvas-capabilities/v4"

type Registry struct{ descriptors map[string]Descriptor }

func NewRegistry(descriptors []Descriptor) (*Registry, error) {
	items := make(map[string]Descriptor, len(descriptors))
	generationModes := make(map[string]string, len(descriptors))
	for _, descriptor := range descriptors {
		descriptor.Type = normalizeType(descriptor.Type)
		descriptor.Version = strings.TrimSpace(descriptor.Version)
		descriptor.Label = strings.TrimSpace(descriptor.Label)
		descriptor.Purpose = strings.TrimSpace(descriptor.Purpose)
		descriptor.GoodFor = normalizeFields(descriptor.GoodFor)
		descriptor.NotIdealFor = normalizeFields(descriptor.NotIdealFor)
		descriptor.Tradeoffs = normalizeFields(descriptor.Tradeoffs)
		descriptor.Actions = normalizeFields(descriptor.Actions)
		if descriptor.Type == "" || descriptor.Version == "" || descriptor.Label == "" || descriptor.DefaultWidth <= 0 || descriptor.DefaultHeight <= 0 {
			return nil, fmt.Errorf("invalid canvas capability descriptor %q", descriptor.Type)
		}
		inputKind, err := normalizeInputKind(descriptor.InputKind)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		descriptor.InputKind = inputKind
		generationMode, err := normalizeGenerationMode(descriptor.GenerationMode)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		descriptor.GenerationMode = generationMode
		if generationMode != "" {
			if existing, exists := generationModes[generationMode]; exists {
				return nil, fmt.Errorf("generation mode %q is registered by both %q and %q", generationMode, existing, descriptor.Type)
			}
			generationModes[generationMode] = descriptor.Type
		}
		projectionKind, err := normalizeProjectionKind(descriptor.ProjectionKind)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		descriptor.ProjectionKind = projectionKind
		descriptor.ProjectionField = strings.TrimSpace(descriptor.ProjectionField)
		if (descriptor.ProjectionKind == "") != (descriptor.ProjectionField == "") {
			return nil, fmt.Errorf("capability %q must declare projection kind and field together", descriptor.Type)
		}
		if descriptor.ProjectionField != "" {
			if err := validatePatchPath(descriptor.ProjectionField); err != nil {
				return nil, fmt.Errorf("capability %q has invalid projection field: %w", descriptor.Type, err)
			}
		}
		if descriptor.Connection.MaxInputCount < 0 {
			return nil, fmt.Errorf("capability %q has invalid max input count", descriptor.Type)
		}
		accepted, err := normalizeConnectionKinds(descriptor.Connection.AcceptedInputKinds)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		rejected, err := normalizeConnectionKinds(descriptor.Connection.RejectedInputKinds)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		rejectedSet := make(map[string]struct{}, len(rejected))
		for _, kind := range rejected {
			rejectedSet[kind] = struct{}{}
		}
		for _, kind := range accepted {
			if _, conflict := rejectedSet[kind]; conflict {
				return nil, fmt.Errorf("capability %q accepts and rejects input kind %q", descriptor.Type, kind)
			}
		}
		if descriptor.Connection.CanSource && descriptor.InputKind == "" {
			return nil, fmt.Errorf("capability %q can source without an input kind", descriptor.Type)
		}
		descriptor.Connection.AcceptedInputKinds = accepted
		descriptor.Connection.RejectedInputKinds = rejected
		descriptor.PatchFields, err = normalizePatchFields(descriptor.PatchFields)
		if err != nil {
			return nil, fmt.Errorf("capability %q: %w", descriptor.Type, err)
		}
		if descriptor.CanUpdate != (len(descriptor.PatchFields) > 0) {
			return nil, fmt.Errorf("capability %q must declare both canUpdate and patch fields, or neither", descriptor.Type)
		}
		descriptor.SummaryFields = normalizeFields(descriptor.SummaryFields)
		descriptor.DetailFields = normalizeFields(descriptor.DetailFields)
		if _, exists := items[descriptor.Type]; exists {
			return nil, fmt.Errorf("duplicate canvas capability %q", descriptor.Type)
		}
		items[descriptor.Type] = cloneDescriptor(descriptor)
	}
	return &Registry{descriptors: items}, nil
}

func (r *Registry) Resolve(nodeType string) (Descriptor, bool) {
	if r == nil {
		return Descriptor{}, false
	}
	d, ok := r.descriptors[normalizeType(nodeType)]
	if !ok {
		return Descriptor{}, false
	}
	d = cloneDescriptor(d)
	return d, ok
}
func (r *Registry) List() []Descriptor {
	if r == nil {
		return nil
	}
	out := make([]Descriptor, 0, len(r.descriptors))
	for _, d := range r.descriptors {
		out = append(out, cloneDescriptor(d))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}
func (r *Registry) Types() []string {
	items := r.List()
	out := make([]string, 0, len(items))
	for _, d := range items {
		out = append(out, d.Type)
	}
	return out
}
func (r *Registry) GenerationModeNames() []string {
	seen := map[string]struct{}{}
	for _, d := range r.List() {
		if d.GenerationMode != "" {
			seen[d.GenerationMode] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for mode := range seen {
		out = append(out, mode)
	}
	sort.Strings(out)
	return out
}

func (r *Registry) SupportsGenerationMode(mode string) bool {
	_, ok := r.ResolveGenerationMode(mode)
	return ok
}

func (r *Registry) ResolveGenerationMode(mode string) (Descriptor, bool) {
	mode = normalizeType(mode)
	if mode == "" || r == nil {
		return Descriptor{}, false
	}
	for _, descriptor := range r.descriptors {
		if descriptor.GenerationMode == mode {
			return cloneDescriptor(descriptor), true
		}
	}
	return Descriptor{}, false
}
func (r *Registry) Hash() string {
	data, _ := json.Marshal(registryHashItems(r.List()))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func normalizeFields(fields []string) []string {
	seen := make(map[string]struct{}, len(fields))
	out := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		if _, exists := seen[field]; exists {
			continue
		}
		seen[field] = struct{}{}
		out = append(out, field)
	}
	return out
}

func cloneDescriptor(descriptor Descriptor) Descriptor {
	descriptor.Connection.AcceptedInputKinds = append([]string(nil), descriptor.Connection.AcceptedInputKinds...)
	descriptor.Connection.RejectedInputKinds = append([]string(nil), descriptor.Connection.RejectedInputKinds...)
	descriptor.GoodFor = append([]string(nil), descriptor.GoodFor...)
	descriptor.NotIdealFor = append([]string(nil), descriptor.NotIdealFor...)
	descriptor.Tradeoffs = append([]string(nil), descriptor.Tradeoffs...)
	descriptor.Actions = append([]string(nil), descriptor.Actions...)
	descriptor.SummaryFields = append([]string(nil), descriptor.SummaryFields...)
	descriptor.DetailFields = append([]string(nil), descriptor.DetailFields...)
	patchFields := make(map[string]PatchField, len(descriptor.PatchFields))
	for key, field := range descriptor.PatchFields {
		patchFields[key] = field
	}
	descriptor.PatchFields = patchFields
	return descriptor
}

type hashDescriptor struct {
	Type            string
	Version         string
	Label           string
	Purpose         string
	GoodFor         []string
	NotIdealFor     []string
	Tradeoffs       []string
	Actions         []string
	DefaultWidth    float64
	DefaultHeight   float64
	InputKind       string
	GenerationMode  string
	Connection      hashConnectionPolicy
	CanUpdate       bool
	SummaryFields   []string
	DetailFields    []string
	ProjectionKind  string
	ProjectionField string
	PatchFields     []hashPatchField
}

type hashConnectionPolicy struct {
	CanSource          bool
	CanTarget          bool
	CanReference       bool
	AcceptedInputKinds []string
	RejectedInputKinds []string
	MaxInputCount      int
}

type hashPatchField struct {
	Key         string
	Path        string
	Kind        string
	Label       string
	Order       int
	Description string
	MaxRunes    int
}

func registryHashItems(descriptors []Descriptor) []hashDescriptor {
	items := make([]hashDescriptor, 0, len(descriptors))
	for _, descriptor := range descriptors {
		keys := make([]string, 0, len(descriptor.PatchFields))
		for key := range descriptor.PatchFields {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		patchFields := make([]hashPatchField, 0, len(keys))
		for _, key := range keys {
			field := descriptor.PatchFields[key]
			patchFields = append(patchFields, hashPatchField{Key: key, Path: field.Path, Kind: field.Kind, Label: field.Label, Order: field.Order, Description: field.Description, MaxRunes: field.MaxRunes})
		}
		items = append(items, hashDescriptor{
			Type: descriptor.Type, Version: descriptor.Version, Label: descriptor.Label,
			Purpose: descriptor.Purpose, GoodFor: descriptor.GoodFor, NotIdealFor: descriptor.NotIdealFor,
			Tradeoffs: descriptor.Tradeoffs, Actions: descriptor.Actions,
			DefaultWidth: descriptor.DefaultWidth, DefaultHeight: descriptor.DefaultHeight,
			InputKind: descriptor.InputKind, GenerationMode: descriptor.GenerationMode,
			ProjectionKind: descriptor.ProjectionKind, ProjectionField: descriptor.ProjectionField,
			Connection: hashConnectionPolicy{CanSource: descriptor.Connection.CanSource, CanTarget: descriptor.Connection.CanTarget, CanReference: descriptor.Connection.CanReference, AcceptedInputKinds: descriptor.Connection.AcceptedInputKinds, RejectedInputKinds: descriptor.Connection.RejectedInputKinds, MaxInputCount: descriptor.Connection.MaxInputCount},
			CanUpdate:  descriptor.CanUpdate, SummaryFields: descriptor.SummaryFields, DetailFields: descriptor.DetailFields, PatchFields: patchFields,
		})
	}
	return items
}
