package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func adaptTapNowDetail(detail *tapNowDetail, shareID string) (*TapNowImportResult, error) {
	if detail == nil {
		return nil, errors.New("TapNow 画布数据为空")
	}
	shareID = strings.TrimSpace(shareID)
	if !isTapNowShareID(shareID) {
		return nil, BadAuthRequest("TapNow 分享 ID 格式无效")
	}
	if len(detail.Nodes) > tapNowMaxNodes {
		return nil, fmt.Errorf("TapNow 画布节点过多（最多支持 %d 个）", tapNowMaxNodes)
	}

	now := time.Now()
	batchID := "tapnow-" + strconv.FormatInt(now.UnixMilli(), 36) + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	result := &TapNowImportResult{
		BatchID:            batchID,
		BatchCreatedAt:     now,
		ShareID:            shareID,
		ProjectName:        strings.TrimSpace(detail.Name),
		Nodes:              make([]TapNowCanvasNode, 0, len(detail.Nodes)),
		Connections:        make([]TapNowCanvasConnection, 0, minInt(len(detail.Connections), tapNowMaxConnections)),
		SkippedNodes:       make([]TapNowImportIssue, 0),
		SkippedConnections: make([]TapNowImportIssue, 0),
		Warnings:           make([]TapNowImportWarning, 0),
	}
	if result.ProjectName == "" {
		result.ProjectName = "TapNow 画布"
	}

	mapping := make(map[string]string, len(detail.Nodes))
	seenNodeIDs := make(map[string]struct{}, len(detail.Nodes))
	for _, raw := range detail.Nodes {
		if strings.TrimSpace(raw.DeletedAt) != "" {
			continue
		}
		nodeID := strings.TrimSpace(raw.ID)
		if nodeID == "" && raw.ShortID != 0 {
			nodeID = strconv.FormatInt(raw.ShortID, 10)
		}
		if nodeID == "" {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{Reason: "节点缺少 ID"})
			continue
		}
		if len(nodeID) > 128 {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{ID: nodeID[:128], Reason: "节点 ID 过长"})
			continue
		}
		if _, exists := seenNodeIDs[nodeID]; exists {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{ID: nodeID, Reason: "节点 ID 重复"})
			continue
		}
		seenNodeIDs[nodeID] = struct{}{}

		data, err := decodeTapNowNodeData(raw.Data)
		if err != nil {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{ID: nodeID, Reason: "节点数据格式无效"})
			continue
		}
		kind := strings.ToLower(strings.TrimSpace(raw.Type))
		if kind == "" {
			kind = strings.ToLower(strings.TrimSpace(data.Type))
		}
		if kind != "image" && kind != "video" && kind != "audio" && kind != "text" {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{ID: nodeID, Name: strings.TrimSpace(data.Title), Reason: "暂不支持的节点类型"})
			continue
		}
		if !finiteNumber(raw.Position.X) || !finiteNumber(raw.Position.Y) {
			result.SkippedNodes = append(result.SkippedNodes, TapNowImportIssue{ID: nodeID, Name: strings.TrimSpace(data.Title), Reason: "节点坐标无效"})
			continue
		}

		content, mediaIndex := firstTapNowMediaURL(data)
		if kind == "text" {
			content = strings.TrimSpace(data.Text)
			if content == "" {
				content = strings.TrimSpace(data.Prompt)
			}
			mediaIndex = -1
		}
		width, height := raw.Measured.Width, raw.Measured.Height
		if !positiveFiniteNumber(width) {
			width = 480
		}
		if !positiveFiniteNumber(height) {
			height = 300
		}
		item := TapNowCanvasNode{
			ID:            "tapnow-" + batchID + "-" + nodeID,
			Type:          kind,
			Title:         strings.TrimSpace(data.Title),
			X:             raw.Position.X,
			Y:             raw.Position.Y,
			Width:         width,
			Height:        height,
			Content:       content,
			Prompt:        firstNonEmptyString(strings.TrimSpace(data.Prompt), firstTapNowParam(data.Params, "prompt")),
			Model:         tapNowMapString(data.Params, "model"),
			Size:          firstTapNowParam(data.Params, "aspectRatio", "size"),
			Quality:       tapNowImageQuality(data.Params),
			Seconds:       firstTapNowParam(data.Params, "duration", "seconds"),
			VQuality:      firstTapNowParam(data.Params, "resolution", "vquality"),
			GenerateAudio: tapNowBoolParam(data.Params, "generateAudio"),
			Metadata: TapNowImportMetadata{
				Provider:   "tapnow",
				ShareID:    shareID,
				NodeID:     nodeID,
				BatchID:    batchID,
				SourceType: strings.TrimSpace(data.Type),
			},
		}
		if item.Title == "" {
			item.Title = kind + " 节点"
		}
		item.NaturalWidth = data.Metadata.Width
		item.NaturalHeight = data.Metadata.Height
		if data.Metadata.Duration > 0 && !math.IsNaN(data.Metadata.Duration) && !math.IsInf(data.Metadata.Duration, 0) {
			item.DurationMs = int64(math.Round(data.Metadata.Duration * 1000))
		}
		item.MimeType = inferTapNowMime(kind, content, firstNonEmptyString(data.Prompt, data.Title))
		taskStatus := tapNowTaskStatus(data.TaskInfo)
		hasContent := strings.TrimSpace(content) != ""
		if hasContent {
			item.Status = "success"
			if tapNowTaskFailed(taskStatus) {
				result.ReusedFailedNodeCount++
			}
		} else if tapNowTaskFailed(taskStatus) {
			item.Status = "error"
			item.ErrorDetails = tapNowErrorDetails(data)
			if item.ErrorDetails == "" {
				item.ErrorDetails = "TapNow 生成任务失败"
			}
			result.PlaceholderNodeCount++
		} else {
			item.Status = "idle"
			result.PlaceholderNodeCount++
		}
		mapping[nodeID] = item.ID
		if raw.ShortID != 0 {
			mapping[strconv.FormatInt(raw.ShortID, 10)] = item.ID
		}
		result.Nodes = append(result.Nodes, item)
		if !positiveFiniteNumber(raw.Measured.Width) || !positiveFiniteNumber(raw.Measured.Height) {
			result.Warnings = append(result.Warnings, TapNowImportWarning{ID: nodeID, Message: fmt.Sprintf("节点“%s”尺寸无效，已使用默认尺寸。", item.Title)})
		}
		if mediaIndex >= 0 && len(data.Options) > 1 {
			result.MultiResultNodeCount++
			result.Warnings = append(result.Warnings, TapNowImportWarning{ID: nodeID, Message: fmt.Sprintf("节点“%s”包含多个结果，已导入首个结果。", item.Title)})
		}
	}

	if len(detail.Connections) > tapNowMaxConnections {
		result.Warnings = append(result.Warnings, TapNowImportWarning{Message: fmt.Sprintf("连接超过 %d 条，仅处理前 %d 条。", tapNowMaxConnections, tapNowMaxConnections)})
	}
	seenConnectionIDs := make(map[string]struct{}, len(detail.Connections))
	for index, raw := range detail.Connections {
		if index >= tapNowMaxConnections {
			break
		}
		if strings.TrimSpace(raw.DeletedAt) != "" {
			continue
		}
		connectionID := strings.TrimSpace(raw.ID)
		if connectionID == "" {
			result.SkippedConnections = append(result.SkippedConnections, TapNowImportIssue{Reason: "连接缺少 ID"})
			continue
		}
		if _, exists := seenConnectionIDs[connectionID]; exists {
			result.SkippedConnections = append(result.SkippedConnections, TapNowImportIssue{ID: connectionID, Reason: "连接 ID 重复"})
			continue
		}
		seenConnectionIDs[connectionID] = struct{}{}
		from, okFrom := mapping[strings.TrimSpace(raw.Source)]
		to, okTo := mapping[strings.TrimSpace(raw.Target)]
		if !okFrom || !okTo {
			result.SkippedConnections = append(result.SkippedConnections, TapNowImportIssue{ID: connectionID, Reason: "连接端点节点未导入"})
			continue
		}
		fromHandleID := strings.TrimSpace(raw.SourceHandle)
		toHandleID := strings.TrimSpace(raw.TargetHandle)
		if toHandleID == "" {
			// TapNow 将图片输入句柄放在边 data.valueKey，而不是 targetHandle。
			toHandleID = tapNowMapString(raw.Data, "valueKey")
		}
		result.Connections = append(result.Connections, TapNowCanvasConnection{
			ID:           "tapnow-" + batchID + "-" + connectionID,
			FromNodeID:   from,
			ToNodeID:     to,
			FromHandleID: fromHandleID,
			ToHandleID:   toHandleID,
		})
	}
	result.ImportedNodeCount = len(result.Nodes)
	result.ImportedConnectionCount = len(result.Connections)
	if result.ImportedNodeCount == 0 {
		return nil, errors.New("TapNow 画布没有可导入的有效节点")
	}
	return result, nil
}

func decodeTapNowNodeData(raw json.RawMessage) (tapNowNodeData, error) {
	var data tapNowNodeData
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, `"`) {
		var encoded string
		if err := json.Unmarshal(raw, &encoded); err != nil {
			return data, err
		}
		raw = json.RawMessage(encoded)
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return data, err
	}
	return data, nil
}

func firstTapNowMediaURL(data tapNowNodeData) (string, int) {
	values := make([]string, 0, len(data.Options)+2)
	values = append(values, data.Src)
	values = append(values, data.Options...)
	values = append(values, data.Metadata.URL)
	for index, value := range values {
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || !isTapNowMediaHost(parsed.Hostname()) {
			continue
		}
		return parsed.String(), index
	}
	return "", -1
}

func isTapNowMediaHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	// 导入后的媒体还可能作为后续生成的参考素材，只接受已核验的官方文件域名，
	// 不能根据品牌前缀放行未经确认的同名域，避免把外部 URL 带入后端出网链路。
	return host == "files.tapnow.media"
}

func inferTapNowMime(kind, rawURL, hint string) string {
	lower := strings.ToLower(rawURL + " " + hint)
	switch kind {
	case "image":
		switch {
		case strings.Contains(lower, ".png"):
			return "image/png"
		case strings.Contains(lower, ".jpg") || strings.Contains(lower, ".jpeg"):
			return "image/jpeg"
		case strings.Contains(lower, ".webp"):
			return "image/webp"
		case strings.Contains(lower, ".gif"):
			return "image/gif"
		default:
			return "image/*"
		}
	case "video":
		switch {
		case strings.Contains(lower, ".webm"):
			return "video/webm"
		case strings.Contains(lower, ".mov"):
			return "video/quicktime"
		default:
			return "video/mp4"
		}
	case "audio":
		switch {
		case strings.Contains(lower, ".wav"):
			return "audio/wav"
		case strings.Contains(lower, ".flac"):
			return "audio/flac"
		case strings.Contains(lower, ".ogg") || strings.Contains(lower, ".oga"):
			return "audio/ogg"
		case strings.Contains(lower, ".m4a"):
			return "audio/mp4"
		default:
			return "audio/mpeg"
		}
	case "text":
		return "text/plain"
	default:
		return "application/octet-stream"
	}
}

func tapNowMapString(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	if value == nil {
		return ""
	}
	if stringValue, ok := value.(string); ok {
		return strings.TrimSpace(stringValue)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstTapNowParam(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := tapNowMapString(values, key); value != "" {
			return value
		}
	}
	return ""
}

// TapNow 部分渠道用 imageSize（例如 "2K"），画布合同则使用小写质量档位。
// 只迁移已知档位，避免把渠道私有值静默写成无效的本地质量设置。
func tapNowImageQuality(values map[string]any) string {
	value := firstTapNowParam(values, "quality")
	if value == "" {
		value = firstTapNowParam(values, "imageSize")
	}
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "1k", "2k", "4k", "auto", "low", "medium", "high":
		return normalized
	default:
		return ""
	}
}

func tapNowBoolParam(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok {
		return ""
	}
	if boolean, ok := value.(bool); ok {
		return strconv.FormatBool(boolean)
	}
	return tapNowMapString(values, key)
}

func tapNowTaskStatus(values map[string]any) string {
	status := strings.ToLower(strings.TrimSpace(tapNowMapString(values, "status")))
	return status
}

func tapNowTaskFailed(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "failed", "error", "failure":
		return true
	default:
		return false
	}
}

func tapNowErrorDetails(data tapNowNodeData) string {
	if value := strings.TrimSpace(data.Error); value != "" {
		return value
	}
	if value := strings.TrimSpace(data.FailedReason); value != "" {
		return value
	}
	for _, key := range []string{"error", "failedReason", "message"} {
		if value := tapNowMapString(data.TaskInfo, key); value != "" {
			return value
		}
	}
	return ""
}

func isTapNowShareID(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-') {
			return false
		}
	}
	return true
}

func finiteNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func positiveFiniteNumber(value float64) bool {
	return finiteNumber(value) && value > 0
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
