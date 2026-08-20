package service

import (
	"strings"
	"testing"
)

func TestAdaptLibTVDetailSelectsFirstMediaAndReportsPartialImport(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.ProjectMeta.Name = "测试画布"
	detail.NodeList = []libTVRawNode{
		{
			NodeKey: "image-1",
			Name:    "多图节点",
			Data:    `{"type":"image","url":["https://example.com/first.png","https://example.com/second.png"],"params":{"prompt":"prompt","model":"model"},"_resourceMeta":{"items":[{"width":1024,"height":768}]}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "12", Y: "34"},
			Measured: struct {
				Width  string `json:"width"`
				Height string `json:"height"`
			}{Width: "640", Height: "360"},
		},
		{
			NodeKey: "failed-video",
			Name:    "失败视频",
			Data:    `{"type":"video","url":[],"taskInfo":{"status":3,"failedReason":"生成失败"}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "500", Y: "600"},
		},
		{
			NodeKey: "stale-video",
			Name:    "过期视频",
			Data:    `{"type":"video","url":["https://example.com/video.mp4"],"taskInfo":{"status":2},"isStale":true,"_resourceMeta":{"items":[{"width":1920,"height":1080,"durationSec":5.2506}]}}`,
			Position: struct {
				X string `json:"positionX"`
				Y string `json:"positionY"`
			}{X: "900", Y: "1200"},
			Measured: struct {
				Width  string `json:"width"`
				Height string `json:"height"`
			}{Width: "640", Height: "360"},
		},
	}
	detail.ConnectionList = []libTVRawConnection{
		{ConnectionID: "valid", Source: "image-1", Target: "stale-video"},
		{ConnectionID: "dangling", Source: "image-1", Target: "failed-video"},
	}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if result.ImportedNodeCount != 3 || result.ImportedConnectionCount != 2 {
		t.Fatalf("counts = (%d, %d), want (3, 2)", result.ImportedNodeCount, result.ImportedConnectionCount)
	}
	if len(result.SkippedNodes) != 0 || len(result.SkippedConnections) != 0 {
		t.Fatalf("unexpected skipped items: nodes=%#v connections=%#v", result.SkippedNodes, result.SkippedConnections)
	}
	if result.PlaceholderNodeCount != 1 || result.ReusedFailedNodeCount != 0 {
		t.Fatalf("failure handling counts = (placeholder=%d, reused=%d), want (1, 0)", result.PlaceholderNodeCount, result.ReusedFailedNodeCount)
	}
	if result.BatchCreatedAt.IsZero() {
		t.Fatal("batch created time must not be zero")
	}
	if got := result.Nodes[0]; got.Content != "https://example.com/first.png" || got.X != 12 || got.Y != 34 || got.Width != 640 || got.Height != 360 {
		t.Fatalf("mapped image = %#v", got)
	}
	if got := result.Nodes[0]; got.Prompt != "prompt" || got.Model != "model" || got.NaturalWidth != 1024 || got.NaturalHeight != 768 {
		t.Fatalf("mapped image metadata = %#v", got)
	}
	if got := result.Nodes[1]; got.DurationMs != 0 || got.MimeType != "video/mp4" || got.Status != "error" || got.ErrorDetails != "生成失败" {
		t.Fatalf("mapped video metadata = %#v", got)
	}
	if got := result.Nodes[0].Metadata.Provider; got != "libtv" {
		t.Fatalf("metadata provider = %q, want libtv", got)
	}
	if len(result.Warnings) != 3 {
		t.Fatalf("warnings = %#v", result.Warnings)
	}
}

func TestAdaptLibTVDetailKeepsFailedNodeWithHistoricalMedia(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "failed-image",
		Data:    `{"type":"image","url":["https://example.com/history.png"],"taskInfo":{"status":3,"failedReason":"本次生成失败"}}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "10", Y: "20"},
	}}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if len(result.Nodes) != 1 || result.Nodes[0].Content != "https://example.com/history.png" {
		t.Fatalf("historical media node = %#v", result.Nodes)
	}
	if result.Nodes[0].Status != "success" || result.ReusedFailedNodeCount != 1 {
		t.Fatalf("failure reuse = node=%#v count=%d", result.Nodes[0], result.ReusedFailedNodeCount)
	}
}

func TestAdaptLibTVDetailConvertsMaterialStyleToImage(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "style-1",
		Name:    "风格素材",
		Data:    `{"type":"material-style","coverUrl":"https://example.com/style.png","styleAssetUuid":"asset-1","styleVersionUuid":"version-1","styleName":"电影感"}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "1", Y: "2"},
	}}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if len(result.Nodes) != 1 {
		t.Fatalf("nodes = %#v", result.Nodes)
	}
	node := result.Nodes[0]
	if node.Type != "image" || node.Content != "https://example.com/style.png" || result.ConvertedSpecialCount != 1 {
		t.Fatalf("converted style node = %#v count=%d", node, result.ConvertedSpecialCount)
	}
	if node.Metadata.StyleAssetUUID != "asset-1" || node.Metadata.StyleVersionUUID != "version-1" || node.Metadata.StyleName != "电影感" {
		t.Fatalf("style metadata = %#v", node.Metadata)
	}
}

func TestAdaptLibTVDetailGeneratesDistinctBatchIDs(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.NodeList = []libTVRawNode{{
		NodeKey: "image-1",
		Data:    `{"type":"image","url":["https://example.com/image.png"]}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "0", Y: "0"},
	}}

	first, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("first adaptLibTVDetail() error = %v", err)
	}
	second, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("second adaptLibTVDetail() error = %v", err)
	}
	if first.BatchID == second.BatchID {
		t.Fatalf("batch IDs are not unique: %q", first.BatchID)
	}
	if !strings.HasPrefix(first.Nodes[0].ID, "libtv-"+first.BatchID+"-") {
		t.Fatalf("node ID %q does not contain batch ID %q", first.Nodes[0].ID, first.BatchID)
	}
}

func TestAdaptLibTVDetailRejectsCanvasWithoutImportableNodes(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{
		NodeKey: "unsupported",
		Data:    `{"type":"text","url":[]}`,
	}}}

	if _, err := adaptLibTVDetail(detail); err == nil {
		t.Fatal("adaptLibTVDetail() error = nil, want an error")
	}
}

func TestAdaptLibTVDetailKeepsReportListsNonNilAndResourceIndex(t *testing.T) {
	detail := &libTVDetail{}
	detail.ProjectMeta.UUID = "project-uuid"
	detail.NodeList = []libTVRawNode{{
		NodeKey: "image-1",
		Data:    `{"type":"image","url":["http://example.com/rejected.png","https://example.com/selected.png"],"_resourceMeta":{"items":[{"width":100,"height":100},{"width":200,"height":300}]}}`,
		Position: struct {
			X string `json:"positionX"`
			Y string `json:"positionY"`
		}{X: "10", Y: "20"},
		Measured: struct {
			Width  string `json:"width"`
			Height string `json:"height"`
		}{Width: "200", Height: "300"},
	}}

	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatalf("adaptLibTVDetail() error = %v", err)
	}
	if result.SkippedNodes == nil || result.SkippedConnections == nil || result.Warnings == nil {
		t.Fatalf("report slices must not be nil: %#v", result)
	}
	if got := result.Nodes[0]; got.Content != "https://example.com/selected.png" || got.NaturalWidth != 200 || got.NaturalHeight != 300 {
		t.Fatalf("selected media metadata = %#v", got)
	}
}
