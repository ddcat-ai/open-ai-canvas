package tool

import (
	"encoding/json"
	"fmt"
	"slices"
)

// Definition is the JSON-schema boundary shared with model providers.
// Parameters remains RawMessage because JSON Schema is an external vocabulary.
type Definition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// Binding connects one tool definition with its typed host-side implementation.
// The host owns authorization, persistence and side effects; this package cannot
// depend on the application composition root.
type Binding[H any] struct {
	Definition Definition
	Handler    H
}

type Registry[H any] struct {
	bindings []Binding[H]
	byName   map[string]int
}

func NewRegistry[H any](bindings []Binding[H]) (*Registry[H], error) {
	r := &Registry[H]{byName: make(map[string]int, len(bindings))}
	for _, binding := range bindings {
		name := binding.Definition.Name
		if _, known := Get(name); !known {
			return nil, fmt.Errorf("tool definition has no policy: %s", name)
		}
		if _, duplicate := r.byName[name]; duplicate {
			return nil, fmt.Errorf("duplicate tool definition: %s", name)
		}
		if !json.Valid(binding.Definition.Parameters) {
			return nil, fmt.Errorf("invalid tool schema: %s", name)
		}
		binding.Definition.Parameters = slices.Clone(binding.Definition.Parameters)
		r.byName[name] = len(r.bindings)
		r.bindings = append(r.bindings, binding)
	}
	for _, name := range Names() {
		if _, exists := r.byName[name]; !exists {
			return nil, fmt.Errorf("tool policy has no binding: %s", name)
		}
	}
	return r, nil
}

func (r *Registry[H]) Lookup(name string) (Binding[H], bool) {
	index, exists := r.byName[name]
	if !exists {
		return Binding[H]{}, false
	}
	binding := r.bindings[index]
	binding.Definition.Parameters = slices.Clone(binding.Definition.Parameters)
	return binding, true
}

func (r *Registry[H]) Definitions(scope Scope) []Definition {
	definitions := make([]Definition, 0, len(r.bindings))
	for _, binding := range r.bindings {
		if Of(binding.Definition.Name).Allowed(scope) {
			definition := binding.Definition
			definition.Parameters = slices.Clone(definition.Parameters)
			definitions = append(definitions, definition)
		}
	}
	return definitions
}

// Names preserves registration order, which is part of the provider contract.
func (r *Registry[H]) Names() []string {
	names := make([]string, 0, len(r.bindings))
	for _, binding := range r.bindings {
		names = append(names, binding.Definition.Name)
	}
	return names
}
