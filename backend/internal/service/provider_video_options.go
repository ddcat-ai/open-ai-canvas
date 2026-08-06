package service

import (
	"context"
	"strconv"
	"strings"
	"time"
)

func isPublicMediaURL(value string) bool {
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func isSeedanceVideoConfig(config providerConfig) bool {
	model := strings.ToLower(config.Model)
	return strings.Contains(model, "seedance") || strings.Contains(model, "doubao-seedance") || isArkPlanVideoConfig(config)
}

func isGrokVideoConfig(config providerConfig) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(config.Model)), "grok")
}

func isArkPlanVideoConfig(config providerConfig) bool {
	return strings.Contains(strings.ToLower(config.BaseURL), "/api/plan/v3")
}

func normalizeImageQuality(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1k":
		return "low"
	case "2k":
		return "medium"
	case "4k":
		return "high"
	default:
		return value
	}
}

func normalizePixelSize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" {
		return ""
	}
	// 画布按比例保存常用预设；图片接口只接受像素尺寸，必须在请求边界完成转换。
	switch value {
	case "1:1":
		return "1024x1024"
	case "3:2":
		return "1536x1024"
	case "2:3":
		return "1024x1536"
	case "4:3":
		return "1360x1024"
	case "3:4":
		return "1024x1360"
	case "16:9":
		return "1824x1024"
	case "9:16":
		return "1024x1824"
	case "21:9":
		return "2352x1008"
	}
	if strings.Contains(value, "x") {
		return value
	}
	return ""
}

func normalizeVideoSize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" {
		return ""
	}
	if strings.Contains(value, "x") {
		return value
	}
	if value == "9:16" || value == "2:3" || value == "3:4" {
		return "720x1280"
	}
	return "1280x720"
}

func normalizeVideoResolution(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" || value == "medium" || value == "high" {
		return "720p"
	}
	if value == "low" {
		return "480p"
	}
	if strings.EqualFold(value, "4k") {
		return "2160p"
	}
	if strings.HasSuffix(value, "p") {
		return value
	}
	return value + "p"
}

func normalizeXAIVideoDuration(value string) int {
	duration, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || duration <= 0 {
		return 6
	}
	return duration
}

func normalizeXAIVideoResolution(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "480", "480p", "low":
		return "480p"
	case "1080", "1080p":
		return "1080p"
	case "2160", "2160p", "4k":
		return "2160p"
	default:
		return "720p"
	}
}

func normalizeXAIVideoAspectRatio(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	allowed := map[string]bool{
		"1:1": true, "16:9": true, "9:16": true, "4:3": true,
		"3:4": true, "3:2": true, "2:3": true,
	}
	if allowed[value] {
		return value
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return "16:9"
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return "16:9"
	}
	ratio := float64(width) / float64(height)
	candidates := []struct {
		name  string
		ratio float64
	}{
		{name: "1:1", ratio: 1},
		{name: "16:9", ratio: 16.0 / 9},
		{name: "9:16", ratio: 9.0 / 16},
		{name: "4:3", ratio: 4.0 / 3},
		{name: "3:4", ratio: 3.0 / 4},
		{name: "3:2", ratio: 3.0 / 2},
		{name: "2:3", ratio: 2.0 / 3},
	}
	bestName := "16:9"
	bestDifference := 2.0
	for _, candidate := range candidates {
		difference := ratio - candidate.ratio
		if difference < 0 {
			difference = -difference
		}
		if difference < bestDifference {
			bestName = candidate.name
			bestDifference = difference
		}
	}
	return bestName
}

func normalizeSeedanceDuration(value string) int {
	if strings.TrimSpace(value) == "-1" {
		return -1
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || seconds <= 0 {
		return 5
	}
	return seconds
}

func normalizeSeedanceVideosDuration(value string) int {
	return normalizeSeedanceDuration(value)
}

func normalizeSeedanceRatio(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" || value == "adaptive" {
		return "adaptive"
	}
	switch value {
	case "16:9", "9:16", "1:1", "4:3", "3:4", "21:9":
		return value
	default:
		return "adaptive"
	}
}

func normalizeSeedanceVideosRatio(value string) string {
	ratio := normalizeSeedanceRatio(value)
	if ratio == "adaptive" {
		return "16:9"
	}
	return ratio
}

func normalizeSeedanceResolution(value string, model string) string {
	resolution := strings.TrimSuffix(strings.TrimSpace(value), "p")
	if strings.EqualFold(resolution, "4k") {
		resolution = "2160"
	}
	switch resolution {
	case "480", "720", "1080", "2160":
	default:
		if value == "low" {
			resolution = "480"
		} else {
			resolution = "720"
		}
	}
	if strings.Contains(strings.ToLower(model), "fast") && (resolution == "1080" || resolution == "2160") {
		resolution = "720"
	}
	return resolution + "p"
}

func parseBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return fallback
	}
}

func parseFloat(value string, fallback float64) float64 {
	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || number == 0 {
		return fallback
	}
	return number
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
