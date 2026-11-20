// Package ecommerceskills holds deterministic first-party planning skills for
// the ecommerce Agent. Skills never invent product facts: they only reorganise
// seller-confirmed fields and reviewed knowledge into planning constraints.
package ecommerceskills

import (
	"strings"
	"time"
)

const Version = "ecommerce-skills-v1-20261030"

// KnowledgeRef is the part of a reviewed knowledge entry a skill may read.
type KnowledgeRef struct {
	ID       string `json:"id"`
	Domain   string `json:"domain"`
	Title    string `json:"title"`
	Guidance string `json:"guidance"`
}

// Invocation is the auditable record of one skill call.
type Invocation struct {
	Skill          string    `json:"skill"`
	Version        string    `json:"version"`
	Stage          string    `json:"stage"`
	KnowledgeBasis []string  `json:"knowledgeBasis"`
	Input          any       `json:"input"`
	Output         any       `json:"output"`
	At             time.Time `json:"at"`
}

func newInvocation(skill, stage string, basis []string, input, output any) Invocation {
	if basis == nil {
		basis = []string{}
	}
	return Invocation{Skill: skill, Version: Version, Stage: stage, KnowledgeBasis: basis, Input: input, Output: output, At: time.Now().UTC()}
}

// guidanceSegment returns the clause after label up to the next sentence end,
// e.g. "视觉策划重点：..." in KB01 product knowledge.
func guidanceSegment(guidance, label string) string {
	index := strings.Index(guidance, label)
	if index < 0 {
		return ""
	}
	rest := guidance[index+len(label):]
	if end := strings.IndexAny(rest, "。;；"); end >= 0 {
		rest = rest[:end]
	}
	return strings.TrimSpace(rest)
}

func splitList(text string) []string {
	parts := strings.FieldsFunc(text, func(r rune) bool { return r == '、' || r == ',' || r == '，' })
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, part)
		}
	}
	return result
}

// firstSentence shortens a guidance text to one sentence of at most limit runes.
func firstSentence(text string, limit int) string {
	if end := strings.IndexAny(text, "。；;"); end >= 0 {
		text = text[:end]
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func refsInDomain(refs []KnowledgeRef, domain string) []KnowledgeRef {
	result := []KnowledgeRef{}
	for _, ref := range refs {
		if ref.Domain == domain {
			result = append(result, ref)
		}
	}
	return result
}

func refIDs(refs []KnowledgeRef) []string {
	ids := make([]string, 0, len(refs))
	for _, ref := range refs {
		ids = append(ids, ref.ID)
	}
	return ids
}
