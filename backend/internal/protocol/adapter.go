package protocol

import "context"

// Adapter owns only protocol translation. The host owns credentials, outbound
// security, polling leases, billing, result downloads and task recovery.
type Adapter interface {
	Metadata() Metadata
	BuildCreate(context.Context, RequestContext) (RequestSpec, error)
	ParseCreate(context.Context, []byte) (CreateResult, error)
	BuildPoll(context.Context, PollContext) (RequestSpec, error)
	ParsePoll(context.Context, PollContext, []byte) (PollResult, error)
	BuildCancel(context.Context, PollContext) (RequestSpec, error)
}

// AgentAdapter is the optional protocol surface for tool-capable text calls.
// The host still owns credentials, outbound policy and billing; a plugin only
// maps the platform's agent request into the provider payload and parses the
// provider response back into the platform tool-call contract.
type AgentAdapter interface {
	BuildAgent(context.Context, AgentRequestContext) (RequestSpec, error)
	ParseAgent(context.Context, []byte) (AgentResult, error)
}

type AgentRequestContext struct {
	BaseURL string
	Model   string
	Request map[string]any
}

type AgentToolCall struct {
	ID        string
	Name      string
	Arguments string
}

type AgentResult struct {
	Text      string
	Reasoning string
	ToolCalls []AgentToolCall
}

type UnavailableAdapter struct {
	Info Metadata
}

func (a UnavailableAdapter) Metadata() Metadata { return a.Info }

func (a UnavailableAdapter) BuildCreate(context.Context, RequestContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}

func (a UnavailableAdapter) ParseCreate(context.Context, []byte) (CreateResult, error) {
	return CreateResult{}, unavailable(a.Info)
}

func (a UnavailableAdapter) BuildPoll(context.Context, PollContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}

func (a UnavailableAdapter) ParsePoll(context.Context, PollContext, []byte) (PollResult, error) {
	return PollResult{}, unavailable(a.Info)
}

func (a UnavailableAdapter) BuildCancel(context.Context, PollContext) (RequestSpec, error) {
	return RequestSpec{}, unavailable(a.Info)
}
