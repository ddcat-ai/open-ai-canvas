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

func adaptLibTVDetail(detail *libTVDetail) (*LibTVImportResult, error) {
	if detail == nil {
		return nil, errors.New("LibTV 画布数据为空")
	}
	now := time.Now()
	batchID := strconv.FormatInt(now.UnixMilli(), 36) + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	result := &LibTVImportResult{
		BatchID:            batchID,
		BatchCreatedAt:     now,
		ProjectUUID:        detail.ProjectMeta.UUID,
		ProjectName:        detail.ProjectMeta.Name,
		Nodes:              make([]LibTVCanvasNode, 0),
		Connections:        make([]LibTVCanvasConnection, 0),
		SkippedNodes:       make([]LibTVImportIssue, 0),
		SkippedConnections: make([]LibTVImportIssue, 0),
		Warnings:           make([]LibTVImportWarning, 0),
	}
	mapping := make(map[string]string, len(detail.NodeList))
	seenNodeKeys := make(map[string]struct{}, len(detail.NodeList))
	for _, raw := range detail.NodeList {
		nodeKey := strings.TrimSpace(raw.NodeKey)
		if nodeKey == "" {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{Name: raw.Name, Reason: "节点缺少 nodeKey"})
			continue
		}
		if _, exists := seenNodeKeys[nodeKey]; exists {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{ID: nodeKey, Name: raw.Name, Reason: "节点 nodeKey 重复"})
			continue
		}
		seenNodeKeys[nodeKey] = struct{}{}

		var data libTVNodeData
		if err := json.Unmarshal([]byte(raw.Data), &data); err != nil {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{ID: nodeKey, Name: raw.Name, Reason: "节点数据格式无效"})
			continue
		}
		taskStatus := data.TaskInfo.Status
		if taskStatus == 0 && raw.TaskInfo.Status != 0 {
			taskStatus = raw.TaskInfo.Status
		}
		sourceType := strings.ToLower(strings.TrimSpace(data.Type))
		kind := sourceType
		if sourceType == "material-style" {
			// 风格素材没有普通生成 URL，但有可复用封面时可以降级为宿主图片参考节点。
			kind = "image"
		} else if kind != "image" && kind != "video" {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{ID: nodeKey, Name: raw.Name, Reason: "暂不支持的节点类型"})
			continue
		}
		mediaURL, mediaIndex := firstLibTVMediaURL(data.URL)
		if mediaURL == "" && sourceType == "material-style" {
			mediaURL, mediaIndex = firstLibTVMediaURL([]string{data.CoverURL})
		}

		x, okX := finiteFloat(raw.Position.X)
		y, okY := finiteFloat(raw.Position.Y)
		if !okX || !okY {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{ID: nodeKey, Name: raw.Name, Reason: "节点坐标无效"})
			continue
		}
		width, okWidth := positiveFiniteFloat(raw.Measured.Width)
		height, okHeight := positiveFiniteFloat(raw.Measured.Height)
		if !okWidth {
			width = 480
		}
		if !okHeight {
			height = 300
		}
		item := LibTVCanvasNode{
			ID:      "libtv-" + batchID + "-" + nodeKey,
			Type:    kind,
			Title:   strings.TrimSpace(raw.Name),
			X:       x,
			Y:       y,
			Width:   width,
			Height:  height,
			Content: mediaURL,
			Prompt:  mapString(data.Params, "prompt"),
			Model:   mapString(data.Params, "model"),
			Metadata: LibTVImportMetadata{
				Provider:         "libtv",
				ProjectUUID:      result.ProjectUUID,
				NodeKey:          nodeKey,
				BatchID:          batchID,
				SourceType:       sourceType,
				StyleAssetUUID:   strings.TrimSpace(data.StyleAssetUUID),
				StyleVersionUUID: strings.TrimSpace(data.StyleVersionUUID),
				StyleName:        strings.TrimSpace(data.StyleName),
			},
		}
		if item.Title == "" {
			item.Title = kind + " 节点"
		}
		if mediaIndex >= 0 && mediaIndex < len(data.ResourceMeta.Items) {
			resource := data.ResourceMeta.Items[mediaIndex]
			item.NaturalWidth = resource.Width
			item.NaturalHeight = resource.Height
			if resource.DurationSec > 0 && !math.IsNaN(resource.DurationSec) && !math.IsInf(resource.DurationSec, 0) {
				item.DurationMs = int64(math.Round(resource.DurationSec * 1000))
			}
		}
		item.MimeType = inferMediaMime(kind, mediaURL)
		if mediaURL == "" {
			result.PlaceholderNodeCount++
			if taskStatus == 3 {
				// 没有历史结果的失败节点仍保留拓扑，并以失败占位状态呈现。
				item.Status = "error"
				item.ErrorDetails = firstNonEmptyString(data.TaskInfo.FailedReason, raw.TaskInfo.FailedReason, "LibTV 生成任务失败")
			} else {
				item.Status = "idle"
			}
		} else {
			item.Status = "success"
			if taskStatus == 3 {
				// 最近一次任务失败不应覆盖节点中仍可用的历史资源。
				result.ReusedFailedNodeCount++
			}
		}
		mapping[nodeKey] = item.ID
		result.Nodes = append(result.Nodes, item)
		if sourceType == "material-style" {
			result.ConvertedSpecialCount++
		}
		if !okWidth || !okHeight {
			result.Warnings = append(result.Warnings, LibTVImportWarning{ID: nodeKey, Message: fmt.Sprintf("节点“%s”尺寸无效，已使用默认尺寸。", item.Title)})
		}
		if len(data.URL) > 1 && mediaURL != "" {
			result.MultiResultNodeCount++
			result.Warnings = append(result.Warnings, LibTVImportWarning{ID: nodeKey, Message: fmt.Sprintf("节点“%s”包含 %d 个结果，已导入第 %d 个。", item.Title, len(data.URL), mediaIndex+1)})
		}
		if data.IsStale || raw.IsStale {
			result.StaleNodeCount++
			result.Warnings = append(result.Warnings, LibTVImportWarning{ID: nodeKey, Message: fmt.Sprintf("节点“%s”已标记为过期，但现有资源仍已导入。", item.Title)})
		}
	}

	seenConnectionIDs := make(map[string]struct{}, len(detail.ConnectionList))
	for _, raw := range detail.ConnectionList {
		connectionID := strings.TrimSpace(raw.ConnectionID)
		if connectionID == "" {
			result.SkippedConnections = append(result.SkippedConnections, LibTVImportIssue{Reason: "连接缺少 connectionId"})
			continue
		}
		if _, exists := seenConnectionIDs[connectionID]; exists {
			result.SkippedConnections = append(result.SkippedConnections, LibTVImportIssue{ID: connectionID, Reason: "连接 connectionId 重复"})
			continue
		}
		seenConnectionIDs[connectionID] = struct{}{}
		from, okFrom := mapping[strings.TrimSpace(raw.Source)]
		to, okTo := mapping[strings.TrimSpace(raw.Target)]
		if !okFrom || !okTo {
			result.SkippedConnections = append(result.SkippedConnections, LibTVImportIssue{ID: connectionID, Reason: "连接端点节点未导入"})
			continue
		}
		result.Connections = append(result.Connections, LibTVCanvasConnection{ID: "libtv-" + batchID + "-" + connectionID, FromNodeID: from, ToNodeID: to})
	}
	result.ImportedNodeCount = len(result.Nodes)
	result.ImportedConnectionCount = len(result.Connections)
	if result.ImportedNodeCount == 0 {
		return nil, errors.New("LibTV 画布没有可导入的有效节点")
	}
	return result, nil
}

func mapString(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func isLibTVProjectUUID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func firstLibTVMediaURL(values []string) (string, int) {
	for index, value := range values {
		parsed, err := url.Parse(strings.TrimSpace(value))
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
			continue
		}
		return parsed.String(), index
	}
	return "", -1
}

func finiteFloat(value string) (float64, bool) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0, false
	}
	return parsed, true
}

func positiveFiniteFloat(value string) (float64, bool) {
	parsed, ok := finiteFloat(value)
	return parsed, ok && parsed > 0
}

func inferMediaMime(kind, rawURL string) string {
	lower := strings.ToLower(rawURL)
	if strings.Contains(lower, ".png") {
		return "image/png"
	}
	if strings.Contains(lower, ".jpg") || strings.Contains(lower, ".jpeg") {
		return "image/jpeg"
	}
	if strings.Contains(lower, ".webp") {
		return "image/webp"
	}
	if kind == "video" {
		return "video/mp4"
	}
	return "image/*"
}
