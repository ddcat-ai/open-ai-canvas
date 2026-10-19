package auth

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/kernel"

	"github.com/google/uuid"
)

type libTVTemplateSnapshot struct {
	Nodes []libTVTemplateNode `json:"nodes"`
	Edges []libTVTemplateEdge `json:"edges"`
}

type libTVTemplatePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type libTVTemplateSize struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type libTVTemplateResourceMeta struct {
	Items []struct {
		Width       int     `json:"width"`
		Height      int     `json:"height"`
		DurationSec float64 `json:"durationSec"`
		MimeType    string  `json:"mimeType"`
	} `json:"items"`
}

type libTVTemplateNode struct {
	ID           string                    `json:"id"`
	Type         string                    `json:"type"`
	ParentID     string                    `json:"parentId"`
	Data         json.RawMessage           `json:"data"`
	Position     *libTVTemplatePoint       `json:"position"`
	Measured     libTVTemplateSize         `json:"measured"`
	Width        float64                   `json:"width"`
	Height       float64                   `json:"height"`
	ResourceMeta libTVTemplateResourceMeta `json:"resourceMeta"`
}

type libTVTemplateNodeData struct {
	Type         string                    `json:"type"`
	Name         string                    `json:"name"`
	URL          []string                  `json:"url"`
	CoverURL     string                    `json:"coverUrl"`
	Text         json.RawMessage           `json:"text"`
	Params       map[string]any            `json:"params"`
	ResourceMeta libTVTemplateResourceMeta `json:"resourceMeta"`
	TaskInfo     struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
}

type libTVTemplateEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

var (
	libTVSnapshotNodeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	libTVReferenceMark  = regexp.MustCompile(`(?i)\{\{\s*(Mixed|Image|Video|Audio|Text)\s+([1-9][0-9]*)\s*\}\}`)
)

func libTVTemplateKind(node libTVTemplateNode, data libTVTemplateNodeData) string {
	kind := strings.ToLower(kernel.FirstNonEmpty(data.Type, node.Type))
	switch kind {
	case "image", "video", "audio", "text":
		return kind
	case "group":
		return "frame"
	case "material-style":
		return "image"
	default:
		return ""
	}
}

func libTVTemplateText(data libTVTemplateNodeData) string {
	var text string
	_ = json.Unmarshal(data.Text, &text)
	return strings.TrimSpace(text)
}

func libTVSafeMediaURLs(data libTVTemplateNodeData) []string {
	urls := make([]string, 0, len(data.URL))
	for _, raw := range data.URL {
		if value := safeLibTVResourceURL(raw); value != "" {
			urls = append(urls, value)
		}
	}
	if len(urls) == 0 && data.Type == "material-style" {
		if value := safeLibTVResourceURL(data.CoverURL); value != "" {
			urls = append(urls, value)
		}
	}
	return urls
}

func libTVTemplateSetting(params map[string]any, key string) any {
	if value, ok := params[key]; ok {
		return value
	}
	settings, _ := params["settings"].(map[string]any)
	return settings[key]
}

func libTVTemplateStringSetting(params map[string]any, key string) string {
	value, _ := libTVTemplateSetting(params, key).(string)
	if len(value) > 64 {
		return ""
	}
	return strings.TrimSpace(value)
}

func libTVTemplateDuration(params map[string]any) float64 {
	var duration float64
	switch value := libTVTemplateSetting(params, "duration").(type) {
	case float64:
		duration = value
	case string:
		duration, _ = strconv.ParseFloat(value, 64)
	}
	if !libTVFinite(duration) || duration < 0 || duration > 36000 {
		return 0
	}
	return duration
}

func libTVReferenceOrders(params map[string]any) map[string][]string {
	orders := make(map[string][]string, 5)
	for _, kind := range []string{"Mixed", "Image", "Video", "Audio", "Text"} {
		key := strings.ToLower(kind) + "List"
		var ids []string
		if values, ok := params[key+"Order"].([]any); ok {
			for _, value := range values {
				id, _ := value.(string)
				ids = append(ids, id)
			}
		} else if values, ok := params[key].([]any); ok {
			for _, value := range values {
				item, _ := value.(map[string]any)
				ids = append(ids, mapString(item, "nodeId"))
			}
		}
		orders[strings.ToLower(kind)] = ids
	}
	return orders
}

func libTVOrderedReferenceIDs(params map[string]any) []string {
	orders := libTVReferenceOrders(params)
	ids := make([]string, 0)
	seen := map[string]bool{}
	for _, kind := range []string{"mixed", "image", "video", "audio", "text"} {
		for _, id := range orders[kind] {
			if libTVSnapshotNodeID.MatchString(id) && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func libTVWorkSteps(snapshot *libTVTemplateSnapshot) []LibTVWorkStep {
	steps := make([]LibTVWorkStep, 0, len(snapshot.Nodes))
	seen := map[string]bool{}
	for _, raw := range snapshot.Nodes {
		var data libTVTemplateNodeData
		if !libTVSnapshotNodeID.MatchString(raw.ID) || seen[raw.ID] || json.Unmarshal(raw.Data, &data) != nil {
			continue
		}
		seen[raw.ID] = true
		kind := libTVTemplateKind(raw, data)
		if kind == "" || kind == "frame" {
			continue
		}
		steps = append(steps, LibTVWorkStep{
			ID: raw.ID, Title: kernel.FirstNonEmpty(data.Name, kind+" 节点"), Type: kind, Prompt: mapString(data.Params, "prompt"),
			Text: libTVTemplateText(data), Model: mapString(data.Params, "model"), MediaURLs: libTVSafeMediaURLs(data),
			AspectRatio: libTVTemplateStringSetting(data.Params, "ratio"), Resolution: libTVTemplateStringSetting(data.Params, "resolution"),
			DurationSeconds: libTVTemplateDuration(data.Params), ReferenceNodeIDs: libTVOrderedReferenceIDs(data.Params),
		})
	}
	return steps
}

func libTVFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// 发布快照的子节点坐标相对父分组；宿主画布存绝对坐标，不能原样复制。
func libTVTemplateWorldPosition(node libTVTemplateNode, nodes map[string]libTVTemplateNode, ancestry map[string]bool) (libTVTemplatePoint, bool) {
	if node.Position == nil || !libTVFinite(node.Position.X) || !libTVFinite(node.Position.Y) || ancestry[node.ID] || len(ancestry) >= 64 {
		return libTVTemplatePoint{}, false
	}
	position := *node.Position
	if node.ParentID == "" {
		return position, true
	}
	parent, ok := nodes[node.ParentID]
	if !ok {
		return libTVTemplatePoint{}, false
	}
	ancestry[node.ID] = true
	parentPosition, ok := libTVTemplateWorldPosition(parent, nodes, ancestry)
	delete(ancestry, node.ID)
	position.X += parentPosition.X
	position.Y += parentPosition.Y
	return position, ok && libTVFinite(position.X) && libTVFinite(position.Y)
}

func adaptLibTVTemplate(work *libTVPublishedTemplate, snapshot *libTVTemplateSnapshot) *LibTVImportResult {
	now := time.Now()
	batchID := strconv.FormatInt(now.UnixMilli(), 36) + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	result := &LibTVImportResult{
		BatchID: batchID, BatchCreatedAt: now, ProjectUUID: work.ProjectUUID, ProjectName: work.Name,
		Nodes: []LibTVCanvasNode{}, Connections: []LibTVCanvasConnection{}, SkippedNodes: []LibTVImportIssue{},
		SkippedConnections: []LibTVImportIssue{}, Warnings: []LibTVImportWarning{},
	}
	byID := make(map[string]libTVTemplateNode, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		if _, exists := byID[node.ID]; !exists && libTVSnapshotNodeID.MatchString(node.ID) {
			byID[node.ID] = node
		}
	}
	mapping, kinds := map[string]string{}, map[string]string{}
	seen := map[string]bool{}
	for _, raw := range snapshot.Nodes {
		var data libTVTemplateNodeData
		reason := ""
		if !libTVSnapshotNodeID.MatchString(raw.ID) || seen[raw.ID] {
			reason = "节点标识无效或重复"
		} else if json.Unmarshal(raw.Data, &data) != nil {
			reason = "节点数据格式无效"
		}
		seen[raw.ID] = true
		kind := libTVTemplateKind(raw, data)
		if reason == "" && kind == "" {
			reason = "暂不支持的节点类型"
		}
		position, positionOK := libTVTemplateWorldPosition(raw, byID, map[string]bool{})
		if reason == "" && !positionOK {
			reason = "节点坐标或父分组无效"
		}
		if reason != "" {
			result.SkippedNodes = append(result.SkippedNodes, LibTVImportIssue{ID: raw.ID, Name: data.Name, Reason: reason})
			continue
		}
		width, height := raw.Measured.Width, raw.Measured.Height
		if width <= 0 || !libTVFinite(width) {
			width = raw.Width
		}
		if height <= 0 || !libTVFinite(height) {
			height = raw.Height
		}
		if width <= 0 || height <= 0 || !libTVFinite(width) || !libTVFinite(height) {
			width, height = 480, 300
			result.Warnings = append(result.Warnings, LibTVImportWarning{ID: raw.ID, Message: "节点尺寸无效，已使用默认尺寸"})
		}
		item := LibTVCanvasNode{
			ID: "libtv-" + batchID + "-" + raw.ID, Type: kind, Title: kernel.FirstNonEmpty(data.Name, kind+" 节点"),
			X: position.X, Y: position.Y, Width: width, Height: height, Prompt: mapString(data.Params, "prompt"),
			Model: mapString(data.Params, "model"), AspectRatio: libTVTemplateStringSetting(data.Params, "ratio"), Status: "success",
			Metadata: LibTVImportMetadata{Provider: "libtv", ProjectUUID: work.ProjectUUID, TemplateUUID: work.TemplateUUID, SnapshotID: work.SnapshotID, NodeKey: raw.ID, BatchID: batchID, SourceType: raw.Type},
		}
		if kind == "frame" {
			item.Content = ""
			result.ConvertedSpecialCount++
		} else if kind == "text" {
			item.Content, item.MimeType = libTVTemplateText(data), "text/plain"
		} else {
			resources := raw.ResourceMeta
			if len(resources.Items) == 0 {
				resources = data.ResourceMeta
			}
			item.Results = libTVImportMediaResults(kind, data.URL, resources, safeLibTVResourceURL)
			if len(item.Results) == 0 && data.Type == "material-style" {
				item.Results = libTVImportMediaResults(kind, []string{data.CoverURL}, libTVTemplateResourceMeta{}, safeLibTVResourceURL)
			}
			libTVSetPrimaryMedia(&item)
			if item.Content == "" {
				result.PlaceholderNodeCount++
				item.Status = "idle"
				if data.TaskInfo.Status == 3 {
					item.Status, item.ErrorDetails = "error", kernel.FirstNonEmpty(data.TaskInfo.FailedReason, "LibTV 生成任务失败")
				}
			} else if data.TaskInfo.Status == 3 {
				result.ReusedFailedNodeCount++
			}
			if item.MimeType == "" {
				item.MimeType = inferTapNowMime(kind, "", "")
			}
			if len(item.Results) > 1 {
				result.MultiResultNodeCount++
			}
			if len(item.Results) > 0 && len(item.Results) < len(data.URL) {
				result.Warnings = append(result.Warnings, LibTVImportWarning{ID: raw.ID, Message: fmt.Sprintf("已保留 %d 个结果，%d 个无效媒体地址已忽略", len(item.Results), len(data.URL)-len(item.Results))})
			}
			if data.Type == "material-style" {
				result.ConvertedSpecialCount++
			}
		}
		mapping[raw.ID], kinds[raw.ID] = item.ID, kind
		result.Nodes = append(result.Nodes, item)
	}
	for index := range result.Nodes {
		item := &result.Nodes[index]
		raw := byID[item.Metadata.NodeKey]
		if kinds[raw.ParentID] == "frame" {
			item.ParentID = mapping[raw.ParentID]
		}
		var data libTVTemplateNodeData
		_ = json.Unmarshal(raw.Data, &data)
		orders := libTVReferenceOrders(data.Params)
		unresolved := false
		item.Prompt = libTVReferenceMark.ReplaceAllStringFunc(item.Prompt, func(mark string) string {
			parts := libTVReferenceMark.FindStringSubmatch(mark)
			position, err := strconv.Atoi(parts[2])
			ids := orders[strings.ToLower(parts[1])]
			if err == nil && position > 0 && position <= len(ids) && mapping[ids[position-1]] != "" {
				return "@[node:" + mapping[ids[position-1]] + "]"
			}
			unresolved = true
			return mark
		})
		if unresolved {
			result.Warnings = append(result.Warnings, LibTVImportWarning{ID: raw.ID, Message: "部分提示词引用缺少公开参考节点，已保留原始标记"})
		}
	}
	seenEdges := map[string]bool{}
	for _, raw := range snapshot.Edges {
		if !libTVSnapshotNodeID.MatchString(raw.ID) || seenEdges[raw.ID] || mapping[raw.Source] == "" || mapping[raw.Target] == "" {
			result.SkippedConnections = append(result.SkippedConnections, LibTVImportIssue{ID: raw.ID, Reason: "连接标识无效、重复或端点未导入"})
			continue
		}
		seenEdges[raw.ID] = true
		result.Connections = append(result.Connections, LibTVCanvasConnection{ID: "libtv-" + batchID + "-" + raw.ID, FromNodeID: mapping[raw.Source], ToNodeID: mapping[raw.Target]})
	}
	result.ImportedNodeCount, result.ImportedConnectionCount = len(result.Nodes), len(result.Connections)
	return result
}
