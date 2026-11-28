package auth

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"yingce/backend/internal/kernel"

	"github.com/google/uuid"
)

func adaptJimengDraft(detail jimengDraftDetail, draft *jimengDraft, resources *jimengResourceSet, projectID string) (*JimengImportResult, error) {
	if len(draft.Nodes) > jimengMaxNodes {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("即梦画布节点过多（最多支持 %d 个）", jimengMaxNodes))
	}

	now := time.Now()
	batchID := "jimeng-" + strconv.FormatInt(now.UnixMilli(), 36) + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	result := &JimengImportResult{
		BatchID:            batchID,
		BatchCreatedAt:     now,
		ProjectID:          projectID,
		ProjectName:        strings.TrimSpace(detail.Project.Name),
		Nodes:              make([]JimengCanvasNode, 0, len(draft.Nodes)),
		Connections:        make([]JimengCanvasConnection, 0, min(len(draft.Edges), jimengMaxConnections)),
		SkippedNodes:       make([]JimengImportIssue, 0),
		SkippedConnections: make([]JimengImportIssue, 0),
		Warnings:           make([]JimengImportWarning, 0),
	}
	if result.ProjectName == "" {
		result.ProjectName = "即梦画布"
	}

	// 分享方隐藏的节点不出现在分享页，导入时一并跳过。
	blocked := make(map[string]struct{}, len(detail.ShareReview.BlockedNodeIDs))
	for _, nodeID := range detail.ShareReview.BlockedNodeIDs {
		if nodeID = strings.TrimSpace(nodeID); nodeID != "" {
			blocked[nodeID] = struct{}{}
		}
	}

	// 即梦的子节点坐标相对分组原点，影策的背板子节点使用画布绝对坐标，这里先统一换算。
	byID := make(map[string]jimengRawNode, len(draft.Nodes))
	order := make([]string, 0, len(draft.Nodes))
	for _, raw := range draft.Nodes {
		nodeID := strings.TrimSpace(raw.ID)
		if nodeID == "" {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{Reason: "节点缺少 ID"})
			continue
		}
		if len(nodeID) > jimengMaxIDLength {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID[:jimengMaxIDLength], Reason: "节点 ID 过长"})
			continue
		}
		if _, exists := byID[nodeID]; exists {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID, Reason: "节点 ID 重复"})
			continue
		}
		byID[nodeID] = raw
		order = append(order, nodeID)
	}
	positions := make(map[string][2]float64, len(order))
	var absolute func(nodeID string, depth int) ([2]float64, bool)
	absolute = func(nodeID string, depth int) ([2]float64, bool) {
		if cached, ok := positions[nodeID]; ok {
			return cached, true
		}
		// 父子互相引用等环状数据在深度上限处放弃，节点按坐标无效跳过。
		if depth > jimengMaxParentDepth {
			return [2]float64{}, false
		}
		raw := byID[nodeID]
		position := [2]float64{raw.Layout.X, raw.Layout.Y}
		if parent, ok := byID[strings.TrimSpace(raw.ParentID)]; ok && jimengIsGroup(parent) {
			parentPosition, ok := absolute(strings.TrimSpace(raw.ParentID), depth+1)
			if !ok {
				return [2]float64{}, false
			}
			position[0] += parentPosition[0]
			position[1] += parentPosition[1]
		}
		positions[nodeID] = position
		return position, true
	}
	// locate 返回节点的绝对坐标；第二个返回值为空表示该节点不能导入。
	locate := func(nodeID string) ([2]float64, string) {
		if _, hidden := blocked[nodeID]; hidden {
			return [2]float64{}, "分享方已隐藏该节点"
		}
		raw := byID[nodeID]
		if !finiteNumber(raw.Layout.X) || !finiteNumber(raw.Layout.Y) {
			return [2]float64{}, "节点坐标无效"
		}
		position, ok := absolute(nodeID, 0)
		if !ok || !finiteNumber(position[0]) || !finiteNumber(position[1]) {
			return [2]float64{}, "节点坐标无效"
		}
		return position, ""
	}

	// 背板先于媒体节点写入，保证分组容器在数组中位于子节点之前。
	frameByRawID := make(map[string]string)
	for _, nodeID := range order {
		raw := byID[nodeID]
		if !jimengIsGroup(raw) {
			continue
		}
		position, reason := locate(nodeID)
		if reason != "" {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID, Name: strings.TrimSpace(raw.Data.Name), Reason: reason})
			continue
		}
		item := JimengCanvasNode{
			ID:     "jimeng-" + batchID + "-" + nodeID,
			Type:   "frame",
			Title:  jimengNodeTitle(raw.Data.Name, "分组"),
			X:      position[0],
			Y:      position[1],
			Width:  jimengSize(raw.Layout.Width, 760),
			Height: jimengSize(raw.Layout.Height, 520),
			Metadata: JimengImportMetadata{
				Provider:  "jimeng",
				ProjectID: projectID,
				NodeID:    nodeID,
				BatchID:   batchID,
			},
		}
		if parent, ok := frameByRawID[strings.TrimSpace(raw.ParentID)]; ok {
			item.ParentID = parent
		}
		frameByRawID[nodeID] = item.ID
		result.Nodes = append(result.Nodes, item)
		result.FrameNodeCount++
	}

	// mapping 只包含媒体节点：连线不指向背板。
	mapping := make(map[string]string, len(order))
	for _, nodeID := range order {
		raw := byID[nodeID]
		if jimengIsGroup(raw) {
			continue
		}
		kind := strings.ToLower(strings.TrimSpace(raw.Type))
		if kind != "image" && kind != "video" {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID, Name: jimengNodeTitle(raw.Data.Title, raw.Type), Reason: "暂不支持的节点类型"})
			continue
		}
		position, reason := locate(nodeID)
		if reason != "" {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID, Name: jimengNodeTitle(raw.Data.Title, kind+" 节点"), Reason: reason})
			continue
		}

		item := JimengCanvasNode{
			ID:     "jimeng-" + batchID + "-" + nodeID,
			Type:   kind,
			Title:  jimengNodeTitle(raw.Data.Title, kind+" 节点"),
			X:      position[0],
			Y:      position[1],
			Width:  jimengSize(raw.Layout.Width, 480),
			Height: jimengSize(raw.Layout.Height, 300),
			Metadata: JimengImportMetadata{
				Provider:   "jimeng",
				ProjectID:  projectID,
				NodeID:     nodeID,
				ResourceID: strings.ToLower(strings.TrimSpace(raw.Data.ResourceID)),
				BatchID:    batchID,
				SourceType: strings.TrimSpace(raw.Data.Source),
			},
		}
		if parent, ok := frameByRawID[strings.TrimSpace(raw.ParentID)]; ok {
			item.ParentID = parent
		}
		if generation := raw.Data.GenerationDraft; generation != nil {
			item.Prompt = jimengPrompt(generation)
			item.Model = firstTapNowParam(generation.ContentSettings, "modelName")
			item.Size = firstTapNowParam(generation.ContentSettings, "aspectRatio")
			if kind == "video" {
				item.Seconds = firstTapNowParam(generation.ContentSettings, "durationSeconds")
				item.VQuality = strings.ToLower(firstTapNowParam(generation.ContentSettings, "resolution"))
			} else {
				item.Quality = jimengImageQuality(generation.ContentSettings)
			}
		}

		// 生成节点会保留多批历史结果，只导入当前展示的这一批。
		historyCount := 0
		for _, batch := range raw.Data.ResourceBatches {
			historyCount += len(batch.ResourceIDs)
		}
		if historyCount > 1 {
			result.MultiResultNodeCount++
			result.Warnings = append(result.Warnings, JimengImportWarning{ID: nodeID, Message: fmt.Sprintf("节点“%s”保留了 %d 个历史结果，已导入当前结果。", item.Title, historyCount)})
		}

		media, resolveErr := resources.resolve(item.Metadata.ResourceID)
		if media != nil && media.Kind != kind {
			result.SkippedNodes = append(result.SkippedNodes, JimengImportIssue{ID: nodeID, Name: item.Title, Reason: "节点类型与素材类型不一致"})
			continue
		}
		if media == nil {
			// 地址不是官方 CDN、素材被删除或仍在生成时保留占位节点，不把不可信地址带入画布。
			item.Status = "idle"
			result.PlaceholderNodeCount++
			if resolveErr == jimengUntrustedMedia {
				result.Warnings = append(result.Warnings, JimengImportWarning{ID: nodeID, Message: fmt.Sprintf("节点“%s”的素材地址不是即梦官方域名，已保留为占位节点。", item.Title)})
			}
		} else {
			item.Status = "success"
			item.Content = media.URL
			item.PreviewContent = media.PreviewURL
			item.NaturalWidth = media.Width
			item.NaturalHeight = media.Height
			item.DurationMs = media.DurationMs
			item.MimeType = media.MimeType
			item.Metadata.ExpiresAt = media.ExpiresAt
			result.MediaExpiresAt = jimengEarliest(result.MediaExpiresAt, media.ExpiresAt)
		}
		if !jimengValidSize(raw.Layout.Width) || !jimengValidSize(raw.Layout.Height) {
			result.Warnings = append(result.Warnings, JimengImportWarning{ID: nodeID, Message: fmt.Sprintf("节点“%s”尺寸无效，已使用默认尺寸。", item.Title)})
		}

		mapping[nodeID] = item.ID
		result.Nodes = append(result.Nodes, item)
	}

	if len(draft.Edges) > jimengMaxConnections {
		result.Warnings = append(result.Warnings, JimengImportWarning{Message: fmt.Sprintf("连接超过 %d 条，仅处理前 %d 条。", jimengMaxConnections, jimengMaxConnections)})
	}
	seenEdgeIDs := make(map[string]struct{}, len(draft.Edges))
	for index, edge := range draft.Edges {
		if index >= jimengMaxConnections {
			break
		}
		edgeID := strings.TrimSpace(edge.ID)
		if edgeID == "" {
			result.SkippedConnections = append(result.SkippedConnections, JimengImportIssue{Reason: "连接缺少 ID"})
			continue
		}
		if len(edgeID) > jimengMaxIDLength {
			result.SkippedConnections = append(result.SkippedConnections, JimengImportIssue{ID: edgeID[:jimengMaxIDLength], Reason: "连接 ID 过长"})
			continue
		}
		if _, exists := seenEdgeIDs[edgeID]; exists {
			result.SkippedConnections = append(result.SkippedConnections, JimengImportIssue{ID: edgeID, Reason: "连接 ID 重复"})
			continue
		}
		seenEdgeIDs[edgeID] = struct{}{}
		from, okFrom := mapping[strings.TrimSpace(edge.Source)]
		to, okTo := mapping[strings.TrimSpace(edge.Target)]
		if !okFrom || !okTo {
			result.SkippedConnections = append(result.SkippedConnections, JimengImportIssue{ID: edgeID, Reason: "连接端点节点未导入"})
			continue
		}
		result.Connections = append(result.Connections, JimengCanvasConnection{
			ID:         "jimeng-" + batchID + "-" + edgeID,
			FromNodeID: from,
			ToNodeID:   to,
		})
	}

	result.ImportedNodeCount = len(result.Nodes)
	result.ImportedConnectionCount = len(result.Connections)
	if result.ImportedNodeCount == 0 {
		return nil, kernel.BadAuthRequest("即梦画布没有可导入的有效节点")
	}
	return result, nil
}

func jimengDraftResourceIDs(nodes []jimengRawNode) []string {
	ids := make([]string, 0, len(nodes))
	seen := make(map[string]struct{}, len(nodes))
	for _, node := range nodes {
		if kind := strings.ToLower(strings.TrimSpace(node.Type)); kind != "image" && kind != "video" {
			continue
		}
		resourceID := strings.ToLower(strings.TrimSpace(node.Data.ResourceID))
		if resourceID == "" {
			continue
		}
		if _, exists := seen[resourceID]; exists {
			continue
		}
		seen[resourceID] = struct{}{}
		ids = append(ids, resourceID)
	}
	return ids
}

func jimengIsGroup(raw jimengRawNode) bool {
	return strings.EqualFold(strings.TrimSpace(raw.Type), "group")
}

// 即梦把整段提示词存进部分节点的标题，节点名只取首行并限长。
func jimengNodeTitle(raw string, fallback string) string {
	title := strings.TrimSpace(strings.SplitN(raw, "\n", 2)[0])
	if runes := []rune(title); len(runes) > jimengTitleRunes {
		title = string(runes[:jimengTitleRunes]) + "…"
	}
	if title == "" {
		return fallback
	}
	return title
}

// 提示词由文本段和内联的节点引用标记交替组成；引用关系已由连线表达，
// 这里只拼接文本段。
func jimengPrompt(generation *jimengGenerationDraft) string {
	if generation == nil {
		return ""
	}
	lines := make([]string, 0, len(generation.Parts))
	for _, part := range generation.Parts {
		if part.Type != "text" {
			continue
		}
		if text := strings.TrimSpace(part.Text); text != "" {
			lines = append(lines, text)
		}
	}
	return strings.Join(lines, "\n")
}

// 即梦图片同时带分辨率档位（如 2K）和质量档位（如 high），画布合同只有一个质量字段：
// 优先迁移分辨率，其次才是质量，且只接受已知档位。
func jimengImageQuality(settings map[string]any) string {
	for _, key := range []string{"resolution", "quality"} {
		switch value := strings.ToLower(firstTapNowParam(settings, key)); value {
		case "1k", "2k", "4k", "auto", "low", "medium", "high":
			return value
		}
	}
	return ""
}

// jimengSize 返回节点尺寸；缺失、非正或超出合理上限时使用默认尺寸。
func jimengSize(value float64, fallback float64) float64 {
	if !jimengValidSize(value) {
		return fallback
	}
	return value
}

func jimengValidSize(value float64) bool {
	return positiveFiniteNumber(value) && value <= jimengMaxSize
}
