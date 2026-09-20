package app

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// VideoTokenEstimate separates the provider's pixel-frame estimate from our
// reservation margin. The formula snapshot can settle videos without provider usage.
type VideoTokenEstimate struct {
	FormulaTokens              int64   `json:"formulaTokens"`
	ReservedTokens             int64   `json:"reservedTokens"`
	OutputWidth                int64   `json:"outputWidth"`
	OutputHeight               int64   `json:"outputHeight"`
	FramesPerSecond            int64   `json:"framesPerSecond"`
	OutputSeconds              int64   `json:"outputSeconds"`
	ReferenceSeconds           float64 `json:"referenceSeconds"`
	ReferenceDurationEstimated bool    `json:"referenceDurationEstimated"`
	DimensionsEstimated        bool    `json:"dimensionsEstimated"`
	ReservationMarginPercent   int64   `json:"reservationMarginPercent"`
}

type videoDimensions struct{ width, height int64 }

// Official Seedance dimensions, not resolution-label multiplication. 4K's
// 4:3 and 21:9 dimensions in particular differ from twice the 1080p dimensions.
var arkVideoDimensions = map[string][]videoDimensions{
	"480p":  {{864, 496}, {752, 560}, {640, 640}, {560, 752}, {496, 864}, {992, 432}},
	"720p":  {{1280, 720}, {1112, 834}, {960, 960}, {834, 1112}, {720, 1280}, {1470, 630}},
	"1080p": {{1920, 1080}, {1664, 1248}, {1440, 1440}, {1248, 1664}, {1080, 1920}, {2206, 946}},
	"2160p": {{3840, 2160}, {3326, 2494}, {2880, 2880}, {2494, 3326}, {2160, 3840}, {4398, 1886}},
}

var arkVideo10Dimensions = map[string][]videoDimensions{
	"480p":  {{864, 480}, {736, 544}, {640, 640}, {544, 736}, {480, 864}, {960, 416}},
	"720p":  {{1248, 704}, {1120, 832}, {960, 960}, {832, 1120}, {704, 1248}, {1504, 640}},
	"1080p": {{1920, 1088}, {1664, 1248}, {1440, 1440}, {1248, 1664}, {1088, 1920}, {2176, 928}},
}

func estimateArkVideoTokens(input map[string]any) tokenBillingEstimate {
	detail, err := estimateArkVideoTokenUsage(input)
	if err != nil {
		return tokenBillingEstimate{Err: err}
	}
	return tokenBillingEstimate{OutputTokens: detail.ReservedTokens, Video: detail}
}

func estimateArkVideoTokenUsage(input map[string]any) (*VideoTokenEstimate, error) {
	config, _ := input["config"].(map[string]any)
	seconds, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(config["videoSeconds"])), 10, 64)
	if err != nil || seconds <= 0 || seconds > (math.MaxInt64-15_000)/1000 {
		return nil, BadAuthRequest("视频 Token 预估需要有效的正整数生成时长")
	}
	modelName := firstNonEmpty(stringValue(config["providerModelKey"]), stringValue(config["model"]))
	dimensions, dimensionsEstimated, err := arkVideoBillingDimensions(stringValue(config["vquality"]), stringValue(config["size"]), modelName)
	if err != nil {
		return nil, err
	}
	referenceMillis, durationEstimated, err := videoReferenceMillis(input["referenceVideos"])
	if err != nil {
		return nil, err
	}
	const fps, margin = int64(24), int64(10)
	if dimensions.width > math.MaxInt64/dimensions.height/fps {
		return nil, BadAuthRequest("视频尺寸超出 Token 计算范围")
	}
	pixels := dimensions.width * dimensions.height
	if seconds > (math.MaxInt64-referenceMillis)/1000 {
		return nil, BadAuthRequest("视频时长超出 Token 计算范围")
	}
	millis := seconds*1000 + referenceMillis
	if millis > (math.MaxInt64-1_023_999)/(pixels*fps) {
		return nil, BadAuthRequest("视频 Token 预估用量超出支持范围")
	}
	// Official formula: (input seconds + output seconds) * W * H * FPS / 1024.
	// Provider usage takes precedence; otherwise the formula snapshot is billable.
	formulaTokens := (millis*pixels*fps + 1_023_999) / 1_024_000
	if formulaTokens > (math.MaxInt64-99)/(100+margin) {
		return nil, BadAuthRequest("视频 Token 预授权用量超出支持范围")
	}
	return &VideoTokenEstimate{
		FormulaTokens: formulaTokens, ReservedTokens: (formulaTokens*(100+margin) + 99) / 100,
		OutputWidth: dimensions.width, OutputHeight: dimensions.height, FramesPerSecond: fps,
		OutputSeconds: seconds, ReferenceSeconds: float64(referenceMillis) / 1000,
		ReferenceDurationEstimated: durationEstimated, DimensionsEstimated: dimensionsEstimated,
		ReservationMarginPercent: margin,
	}, nil
}

func videoReferenceMillis(raw any) (int64, bool, error) {
	if raw == nil {
		return 0, false, nil
	}
	references, ok := raw.([]any)
	if !ok || len(references) > 128 {
		return 0, false, BadAuthRequest("视频 Token 预估的参考视频参数无效")
	}
	var total int64
	unknown := false
	for _, rawReference := range references {
		media, ok := rawReference.(map[string]any)
		if rawReference != nil && !ok {
			return 0, false, BadAuthRequest("视频 Token 预估的参考视频参数无效")
		}
		value := media["durationMs"]
		if value == nil {
			unknown = true
			continue
		}
		duration, err := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		if err != nil || duration < 0 || duration > math.MaxInt64-total {
			return 0, false, BadAuthRequest("参考视频时长参数无效，durationMs 必须为非负整数且不能溢出")
		}
		if duration == 0 {
			unknown = true
		}
		total += duration
	}
	if unknown {
		// The catalog quote has only reference counts; reserve the documented
		// maximum and disclose it instead of pretending the references cost zero.
		return max(total, 15_000), true, nil
	}
	return total, false, nil
}

func arkVideoBillingDimensions(resolution, ratio, modelName string) (videoDimensions, bool, error) {
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	ratio = strings.ToLower(strings.TrimSpace(ratio))
	// Some video protocols expose exact pixels in size instead of a resolution tier.
	if dimensions, ok := videoPixelDimensions(ratio); ok {
		return dimensions, false, nil
	}
	defaulted := resolution == "" || resolution == "auto" || resolution == "high" || resolution == "medium"
	if defaulted {
		resolution = "720p"
	}
	if resolution == "low" {
		resolution = "480p"
	}
	if ratio == "" {
		ratio = "16:9"
		defaulted = true
	}
	switch resolution {
	case "480", "720", "1080", "2160":
		resolution += "p"
	case "4k":
		resolution = "2160p"
	case "2k":
		resolution = "1440p"
	}
	base, exists := arkVideoDimensions[resolution]
	if !exists {
		return videoScaledDimensions(resolution, ratio)
	}
	ratios := []string{"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
	ratio = strings.ToLower(strings.TrimSpace(ratio))
	adaptive := ratio == "adaptive" || ratio == "auto"
	ratioIndex := -1
	for index, value := range ratios {
		if value == ratio {
			ratioIndex = index
		}
	}
	if ratioIndex < 0 && !adaptive {
		return videoScaledDimensions(resolution, ratio)
	}
	name := strings.ReplaceAll(strings.ToLower(modelName), ".", "-")
	is10 := strings.Contains(name, "seedance-1-0")
	is25 := strings.Contains(name, "seedance-2-5")
	known := is10 || is25 || strings.Contains(name, "seedance-1-5") || strings.Contains(name, "seedance-2-0")
	values := append([]videoDimensions(nil), base...)
	if is10 {
		if resolution == "2160p" {
			defaulted = true
		} else {
			values = arkVideo10Dimensions[resolution]
		}
	} else if is25 && resolution == "480p" {
		values[0], values[4] = videoDimensions{854, 480}, videoDimensions{480, 854}
	} else if !known {
		// Endpoint IDs don't identify a model generation. Use the largest
		// documented dimensions per ratio, with an explicit estimate flag.
		for index, value := range arkVideo10Dimensions[resolution] {
			if value.width*value.height > values[index].width*values[index].height {
				values[index] = value
			}
		}
	}
	if !adaptive {
		return values[ratioIndex], !known || defaulted, nil
	}
	largest := values[0]
	for _, value := range values[1:] {
		if value.width*value.height > largest.width*largest.height {
			largest = value
		}
	}
	return largest, true, nil
}

func videoPixelDimensions(size string) (videoDimensions, bool) {
	parts := strings.Split(strings.ReplaceAll(size, "×", "x"), "x")
	if len(parts) != 2 {
		return videoDimensions{}, false
	}
	w, ew := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	h, eh := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	return videoDimensions{w, h}, ew == nil && eh == nil && w > 0 && h > 0
}

// Generic video tiers use the short edge and requested aspect ratio. This is a
// platform pricing convention for non-Seedance sizes, not a provider pixel claim.
func videoScaledDimensions(resolution, ratio string) (videoDimensions, bool, error) {
	raw := strings.TrimSuffix(strings.TrimSuffix(resolution, "横"), "竖")
	edge, err := strconv.ParseInt(strings.TrimSuffix(raw, "p"), 10, 64)
	if err != nil || edge <= 0 {
		return videoDimensions{}, false, BadAuthRequest("视频 Token 计费需要有效分辨率或明确的宽×高尺寸")
	}
	if ratio == "auto" || ratio == "adaptive" {
		ratio = "16:9"
	}
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return videoDimensions{}, false, BadAuthRequest("视频 Token 计费需要有效画幅比例")
	}
	w, ew := strconv.ParseInt(parts[0], 10, 64)
	h, eh := strconv.ParseInt(parts[1], 10, 64)
	if ew != nil || eh != nil || w <= 0 || h <= 0 || edge > (math.MaxInt64-min(w, h))/max(w, h) {
		return videoDimensions{}, false, BadAuthRequest("视频画幅超出 Token 计算范围")
	}
	longEdge := (edge*max(w, h) + min(w, h) - 1) / min(w, h)
	longEdge = (longEdge + 1) / 2 * 2
	if w >= h {
		return videoDimensions{longEdge, edge}, true, nil
	}
	return videoDimensions{edge, longEdge}, true, nil
}
