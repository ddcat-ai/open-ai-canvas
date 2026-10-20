package app

import (
	"encoding/json"
	"slices"
	"sort"
	"strings"
)

// Read identities from the native branch that is actually resumed. Compacted
// ancestors still count as imported; abandoned branches and user-written copies
// of the server prefix do not. This index never restores old dialogue text.
func cloudAgentCreationContextImports(sessionJSONL string) map[string]map[string]any {
	type entry struct {
		ID          string          `json:"id"`
		ParentID    string          `json:"parentId"`
		Type        string          `json:"type"`
		CustomType  string          `json:"customType"`
		Content     json.RawMessage `json:"content"`
		TargetID    string          `json:"targetId"`
		Replacement json.RawMessage `json:"replacement"`
		FirstKeptID string          `json:"firstKeptEntryId"`
	}
	entries := map[string]entry{}
	leaf := ""
	for _, line := range strings.Split(sessionJSONL, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var item entry
		if json.Unmarshal([]byte(line), &item) != nil {
			return nil
		}
		if item.Type == "session" {
			continue
		}
		if item.ID == "" {
			return nil
		}
		entries[item.ID], leaf = item, item.ID
	}
	var path []entry
	seen := map[string]bool{}
	for leaf != "" {
		item, ok := entries[leaf]
		if !ok || seen[leaf] {
			return nil
		}
		seen[leaf] = true
		path = append(path, item)
		leaf = item.ParentID
	}
	slices.Reverse(path)
	positions := map[string]int{}
	for i, item := range path {
		positions[item.ID] = i
	}
	edits := map[string]json.RawMessage{}
	frozenBefore := 0
	for i, item := range path {
		if item.Type == "compaction" {
			firstKept, ok := positions[item.FirstKeptID]
			if !ok || firstKept >= i {
				firstKept = i
			}
			frozenBefore = max(frozenBefore, firstKept)
		} else if item.Type == "context_edit" {
			target, ok := positions[item.TargetID]
			// Edits before compaction affect what entered its summary. Edits
			// after compaction cannot remove an already summarized import.
			if ok && target >= frozenBefore && target < i {
				edits[item.TargetID] = item.Replacement
			}
		}
	}
	imported := map[string]map[string]any{}
	for _, item := range path {
		if item.Type != "custom_message" || item.CustomType != "server-turn-context" {
			continue
		}
		if replacement, edited := edits[item.ID]; edited {
			var value struct {
				Content json.RawMessage `json:"content"`
			}
			if json.Unmarshal(replacement, &value) != nil || len(value.Content) == 0 {
				continue
			}
			item.Content = value.Content
		}
		var content string
		if json.Unmarshal(item.Content, &content) != nil {
			var blocks []struct{ Type, Text string }
			if json.Unmarshal(item.Content, &blocks) != nil {
				continue
			}
			for _, block := range blocks {
				if block.Type == "text" {
					content += block.Text
				}
			}
		}
		if !strings.HasPrefix(content, cloudAgentPiTurnContextPrefix) {
			continue
		}
		var turn struct {
			Handoff []string `json:"handoff"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(content, cloudAgentPiTurnContextPrefix)), &turn) != nil {
			continue
		}
		for _, handoff := range turn.Handoff {
			var frame struct {
				Source  string           `json:"source"`
				Entries []map[string]any `json:"entries"`
			}
			if json.Unmarshal([]byte(handoff), &frame) != nil || frame.Source != "creation_mode_history" {
				continue
			}
			for _, value := range frame.Entries {
				id, _ := value["messageId"].(string)
				if id == "" {
					continue
				}
				prior := imported[id]
				if prior == nil {
					prior = map[string]any{}
					imported[id] = prior
				}
				for key, field := range value {
					if key == "tasks" {
						tasks, _ := prior[key].(map[string]map[string]any)
						if tasks == nil {
							tasks = map[string]map[string]any{}
						}
						updates, _ := field.([]any)
						for _, update := range updates {
							fact, _ := update.(map[string]any)
							taskID, _ := fact["taskId"].(string)
							if taskID == "" {
								continue
							}
							if tasks[taskID] == nil {
								tasks[taskID] = map[string]any{}
							}
							for name, item := range fact {
								tasks[taskID][name] = item
							}
						}
						prior[key] = tasks
					} else {
						prior[key] = field
					}
				}
			}
		}
	}
	return imported
}

func cloudAgentCreationContextMessageIDs(sessionJSONL string) []string {
	imported := cloudAgentCreationContextImports(sessionJSONL)
	ids := make([]string, 0, len(imported))
	for id := range imported {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func cloudAgentCreationContextDelta(current, prior map[string]any) map[string]any {
	if prior == nil {
		return current
	}
	delta := map[string]any{}
	for key, value := range current {
		if key == "tasks" {
			previous, _ := prior[key].(map[string]map[string]any)
			var updates []map[string]any
			for _, task := range value.([]map[string]any) {
				id, _ := task["taskId"].(string)
				change := cloudAgentCreationContextDelta(task, previous[id])
				if len(change) > 0 {
					change["taskId"] = id
					updates = append(updates, change)
				}
			}
			if len(updates) > 0 {
				delta[key] = updates
			}
		} else if mustMarshal(value) != mustMarshal(prior[key]) {
			delta[key] = value
		}
	}
	if current["taskId"] != nil {
		for key, value := range prior {
			if _, present := current[key]; !present && value != nil {
				delta[key] = nil
			}
		}
	}
	if len(delta) > 0 {
		if id, ok := current["messageId"]; ok {
			delta["messageId"] = id
		}
	}
	return delta
}

// Request history is retained for owned task/resource access even when the
// browser sends only new messages. It is not reinserted into the native journal.
func mergeCloudAgentCreationContext(previous, current []CloudAgentCreationContextEntry) []CloudAgentCreationContextEntry {
	result := append([]CloudAgentCreationContextEntry(nil), previous...)
	positions := map[string]int{}
	key := func(item CloudAgentCreationContextEntry) string {
		if item.MessageID != "" {
			return "id:" + item.MessageID
		}
		return "entry:" + mustMarshal(item)
	}
	for i, item := range result {
		positions[key(item)] = i
	}
	for _, item := range current {
		if index, ok := positions[key(item)]; ok {
			result[index] = item
		} else {
			positions[key(item)] = len(result)
			result = append(result, item)
		}
	}
	return result
}
