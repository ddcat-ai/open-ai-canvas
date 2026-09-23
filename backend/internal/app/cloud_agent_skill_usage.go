package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Skill usage telemetry. Every Agent tool call already lands in the durable
// journal, so attribution needs no new table and no write path: we only read
// back what the runs already recorded. This answers the question the skill
// ecosystem otherwise cannot: after a skill is installed, is it ever used?

const (
	// A run window keeps the aggregation bounded; older runs stay in the journal
	// but are not re-scanned on every request.
	cloudAgentSkillUsageRunWindow = 200
	// Card paths are unbounded per pack, so the response only carries the hottest.
	cloudAgentSkillUsageTopCards = 5
)

// CloudAgentSkillUsage aggregates skill adoption for one user.
type CloudAgentSkillUsage struct {
	ScannedRuns int `json:"scannedRuns"`
	// SearchCalls counts retrieval rounds, which are not attributable to a single
	// skill: one call ranks every enabled skill at once.
	SearchCalls int                         `json:"searchCalls"`
	Skills      []CloudAgentSkillUsageEntry `json:"skills"`
}

// CloudAgentSkillUsageEntry is one skill's adoption across the scanned runs.
type CloudAgentSkillUsageEntry struct {
	SkillID   string `json:"skillId"`
	SkillName string `json:"skillName,omitempty"`
	// RunsEnabled counts runs that loaded this skill.
	RunsEnabled int `json:"runsEnabled"`
	// SearchHits counts rounds in which this skill was returned as a match.
	SearchHits int `json:"searchHits"`
	ReadCalls  int `json:"readCalls"`
	// ReadFailures separates rejected reads (bad path, wrong skill) from reads
	// that actually returned content.
	ReadFailures int `json:"readFailures"`
	// EntryReads counts SKILL.md / directory listings; CardReads counts cards.
	// The ratio is the cost signal: entry reads mean the pack outline is still
	// being paid for even when only one card was wanted.
	EntryReads int                        `json:"entryReads"`
	CardReads  int                        `json:"cardReads"`
	TopCards   []CloudAgentSkillCardUsage `json:"topCards,omitempty"`
}

// CloudAgentSkillCardUsage is one card path and how often it was read.
type CloudAgentSkillCardUsage struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

// CloudAgentSkillUsage reports how the caller's skills were actually used.
func (s *Service) CloudAgentSkillUsage(userID string) (*CloudAgentSkillUsage, error) {
	records, err := s.repo.RecentCloudAgentEventsForUser(userID, cloudAgentSkillUsageRunWindow)
	if err != nil {
		return nil, err
	}
	events := make([]CloudAgentEvent, 0, len(records))
	for _, record := range records {
		var event CloudAgentEvent
		if err := json.Unmarshal([]byte(record.EventJSON), &event); err != nil {
			// A corrupt receipt makes the aggregate incomplete; do not report it as valid usage.
			return nil, fmt.Errorf("decode Agent skill usage receipt: %w", err)
		}
		events = append(events, event)
	}
	return cloudAgentSkillUsageFromEvents(events), nil
}

// cloudAgentSkillUsageFromEvents aggregates one user's journal into per-skill
// adoption. It is pure so the attribution rules can be tested without a database.
func cloudAgentSkillUsageFromEvents(events []CloudAgentEvent) *CloudAgentSkillUsage {
	usage := &CloudAgentSkillUsage{Skills: []CloudAgentSkillUsageEntry{}}
	entries := map[string]*CloudAgentSkillUsageEntry{}
	cardCounts := map[string]map[string]int{}
	scannedRuns := map[string]bool{}

	entry := func(skillID string) *CloudAgentSkillUsageEntry {
		if existing, ok := entries[skillID]; ok {
			return existing
		}
		created := &CloudAgentSkillUsageEntry{SkillID: skillID}
		entries[skillID] = created
		return created
	}

	for _, event := range events {
		if event.Type != "tool_completed" && event.Type != "tool_failed" {
			continue
		}
		payload := event.Payload
		name, _ := payload["toolName"].(string)
		switch name {
		case "skills_load":
			scannedRuns[event.RunID] = true
			for _, id := range cloudAgentEventStringSlice(payload["skillIds"]) {
				entry(id).RunsEnabled++
			}
		case "skill_search":
			usage.SearchCalls++
			result, _ := payload["result"].(map[string]any)
			matches, _ := result["matches"].([]any)
			for _, raw := range matches {
				match, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				id, _ := match["skillId"].(string)
				if strings.TrimSpace(id) == "" {
					continue
				}
				entry(id).SearchHits++
			}
		case "skill_read_file":
			id, _ := payload["skillId"].(string)
			if strings.TrimSpace(id) == "" {
				continue
			}
			target := entry(id)
			if event.Type == "tool_failed" {
				target.ReadFailures++
				continue
			}
			target.ReadCalls++
			if label := cloudAgentEventString(payload["skillName"]); label != "" {
				target.SkillName = label
			}
			path := cloudAgentEventString(payload["path"])
			if path == "" || path == cloudAgentSkillEntryPath {
				target.EntryReads++
				continue
			}
			target.CardReads++
			if cardCounts[id] == nil {
				cardCounts[id] = map[string]int{}
			}
			cardCounts[id][path]++
		}
	}
	usage.ScannedRuns = len(scannedRuns)

	for id, target := range entries {
		counts := cardCounts[id]
		if len(counts) == 0 {
			continue
		}
		cards := make([]CloudAgentSkillCardUsage, 0, len(counts))
		for path, count := range counts {
			cards = append(cards, CloudAgentSkillCardUsage{Path: path, Count: count})
		}
		sort.Slice(cards, func(i, j int) bool {
			if cards[i].Count != cards[j].Count {
				return cards[i].Count > cards[j].Count
			}
			return cards[i].Path < cards[j].Path
		})
		if len(cards) > cloudAgentSkillUsageTopCards {
			cards = cards[:cloudAgentSkillUsageTopCards]
		}
		target.TopCards = cards
	}

	for _, target := range entries {
		usage.Skills = append(usage.Skills, *target)
	}
	// Busiest first: the skills a user actually leans on should not be buried.
	sort.Slice(usage.Skills, func(i, j int) bool {
		left, right := usage.Skills[i], usage.Skills[j]
		if left.RunsEnabled != right.RunsEnabled {
			return left.RunsEnabled > right.RunsEnabled
		}
		if left.ReadCalls != right.ReadCalls {
			return left.ReadCalls > right.ReadCalls
		}
		return left.SkillID < right.SkillID
	})
	return usage
}

func cloudAgentEventString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func cloudAgentEventStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, text)
		}
	}
	return out
}
