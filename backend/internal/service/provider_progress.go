package service

import (
	"encoding/json"
	"log"
	"math"
	"strconv"
	"strings"
)

var providerProgressKeys = []string{"progress", "progresspercent", "progresspercentage", "percent", "percentage", "completion", "completionpercent"}

var providerProgressContainers = []string{"data", "result", "task", "output", "operation", "response", "meta", "metadata"}

// syncProviderTaskProgress is deliberately best-effort: progress telemetry must
// never turn a successful provider response into a failed generation request.
func (s *Service) syncProviderTaskProgress(taskID string, responseBody []byte) {
	if s == nil || s.repo == nil || strings.TrimSpace(taskID) == "" {
		return
	}
	progress, ok := providerProgressFromResponse(responseBody)
	if !ok {
		return
	}
	if err := s.repo.UpdateTaskProviderProgress(taskID, progress); err != nil {
		log.Printf("provider progress sync failed: task_id=%s error=%v", taskID, err)
	}
}

func providerProgressFromResponse(responseBody []byte) (int, bool) {
	if len(responseBody) == 0 {
		return 0, false
	}
	var payload any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return 0, false
	}
	return findProviderProgress(payload, 0)
}

func findProviderProgress(value any, depth int) (int, bool) {
	if depth > 8 {
		return 0, false
	}
	switch current := value.(type) {
	case map[string]any:
		for _, wantedKey := range providerProgressKeys {
			for key, candidate := range current {
				if normalizeProviderProgressKey(key) != wantedKey {
					continue
				}
				if progress, ok := normalizeProviderProgressValue(candidate); ok {
					return progress, true
				}
			}
		}
		for _, wantedContainer := range providerProgressContainers {
			for key, nested := range current {
				if normalizeProviderProgressKey(key) != wantedContainer {
					continue
				}
				if progress, ok := findProviderProgress(nested, depth+1); ok {
					return progress, true
				}
			}
		}
	case []any:
		for _, nested := range current {
			if progress, ok := findProviderProgress(nested, depth+1); ok {
				return progress, true
			}
		}
	}
	return 0, false
}

func normalizeProviderProgressValue(value any) (int, bool) {
	var number float64
	explicitPercent := false
	switch current := value.(type) {
	case float64:
		number = current
	case string:
		text := strings.TrimSpace(current)
		if text == "" {
			return 0, false
		}
		explicitPercent = strings.HasSuffix(text, "%")
		text = strings.TrimSpace(strings.TrimSuffix(text, "%"))
		parsed, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 100 {
		return 0, false
	}
	if !explicitPercent && number > 0 && number < 1 {
		number *= 100
	}
	return int(math.Round(number)), true
}

func normalizeProviderProgressKey(value string) string {
	return strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(value)))
}
