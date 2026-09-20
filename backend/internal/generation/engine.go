package generation

import (
	"infinite-canvas/backend/internal/protocol"
)

// Engine 是 generation 域的入口；由 service 组合根构造并注入 Deps。
type Engine struct {
	deps Deps
}

func NewEngine(deps Deps) *Engine {
	return &Engine{deps: deps}
}

func (e *Engine) ProtocolRegistry() *protocol.Registry {
	if e == nil {
		return nil
	}
	if e.deps.Registry != nil {
		return e.deps.Registry
	}
	return loadOfficialFallbackRegistry()
}
