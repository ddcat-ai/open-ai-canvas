package auth

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLibTVTemplatePreservesEveryValidResultWithItsResourceMetadata(t *testing.T) {
	work, snapshot := testLibTVPublishedSnapshot(t)
	snapshot.Nodes[2].ResourceMeta = libTVTemplateResourceMeta{}
	snapshot.Nodes[2].Data = json.RawMessage(`{
		"type":"image","url":["https://other.invalid/skip.png","https://libtv-res.liblib.art/one.png","https://libtv-res.liblib.art/two.png","https://libtv-res.liblib.art/three.png","https://libtv-res.liblib.art/four.png"],
		"params":{"prompt":"参考{{Audio 1}}","audioListOrder":["audio"]},
		"resourceMeta":{"items":[{"width":99,"height":99},{"width":100,"height":200},{"width":300,"height":400},{"width":500,"height":600},{"width":700,"height":800}]}
	}`)
	result := adaptLibTVTemplate(work, snapshot)
	var image LibTVCanvasNode
	for _, node := range result.Nodes {
		if node.Metadata.NodeKey == "image" {
			image = node
		}
	}
	if len(image.Results) != 4 || result.MultiResultNodeCount != 2 {
		t.Fatalf("result preservation = %#v, multi count = %d", image.Results, result.MultiResultNodeCount)
	}
	for i, media := range image.Results {
		if media.SourceIndex != i+1 || media.NaturalWidth != 100+i*200 || media.NaturalHeight != 200+i*200 || media.MimeType != "image/png" {
			t.Fatalf("metadata index shifted for result %d: %#v", i, media)
		}
	}
	if image.Content != image.Results[0].Content || image.NaturalWidth != 100 || image.X != 124 || image.Y != 235 || image.ParentID == "" || !strings.Contains(image.Prompt, "@[node:") {
		t.Fatalf("source node structure changed: %#v", image)
	}
	if result.Connections[0].FromNodeID != image.ID || len(result.Connections) != 1 {
		t.Fatalf("source connection changed: %#v", result.Connections)
	}
	foundInvalidWarning := false
	for _, warning := range result.Warnings {
		if strings.Contains(warning.Message, "导入第") || strings.Contains(warning.Message, "保留第") {
			t.Fatalf("retained obsolete result-loss warning: %#v", warning)
		}
		if warning.ID == "image" && warning.Message == "已保留 4 个结果，1 个无效媒体地址已忽略" {
			foundInvalidWarning = true
		}
	}
	if !foundInvalidWarning {
		t.Fatal("invalid URL was not reported")
	}
}

func TestLibTVTemplatePreservesVideoAndAudioResultDurations(t *testing.T) {
	for _, kind := range []string{"video", "audio"} {
		t.Run(kind, func(t *testing.T) {
			work, snapshot := testLibTVPublishedSnapshot(t)
			snapshot.Nodes[3].ResourceMeta = libTVTemplateResourceMeta{}
			snapshot.Nodes[3].Data = json.RawMessage(`{"type":"` + kind + `","url":["https://libtv-res.liblib.art/one.mp4","https://libtv-res.liblib.art/two.mp4"],"resourceMeta":{"items":[{"durationSec":1.25,"mimeType":"` + kind + `/custom"},{"durationSec":2.5,"width":1920,"height":1080}]}}`)
			result := adaptLibTVTemplate(work, snapshot)
			found := false
			for _, node := range result.Nodes {
				if node.Metadata.NodeKey != "audio" {
					continue
				}
				found = true
				if len(node.Results) != 2 || node.Results[0].DurationMs != 1250 || node.Results[1].DurationMs != 2500 || node.Results[1].NaturalWidth != 1920 || node.Results[0].MimeType != kind+"/custom" {
					t.Fatalf("per-result media metadata lost: %#v", node.Results)
				}
			}
			if !found {
				t.Fatal("expected media node was not imported")
			}
		})
	}
}

func TestLibTVPrivateImportKeepsResourceIndicesAfterInvalidURLs(t *testing.T) {
	detail := &libTVDetail{NodeList: []libTVRawNode{{NodeKey: "video", Data: `{"type":"video","url":["javascript:skip","https://example.com/one.mp4","https://example.com/two.mp4"],"_resourceMeta":{"items":[{"durationSec":99},{"durationSec":1.25,"width":1280,"height":720},{"durationSec":2.5,"width":1920,"height":1080}]}}`}}}
	detail.NodeList[0].Position.X, detail.NodeList[0].Position.Y = "0", "0"
	result, err := adaptLibTVDetail(detail)
	if err != nil {
		t.Fatal(err)
	}
	node := result.Nodes[0]
	if len(node.Results) != 2 || node.Results[0].SourceIndex != 1 || node.Results[0].DurationMs != 1250 || node.Results[1].SourceIndex != 2 || node.Results[1].DurationMs != 2500 || node.Results[1].NaturalWidth != 1920 || node.Content != node.Results[0].Content {
		t.Fatalf("private result metadata lost: %#v", node)
	}
}
