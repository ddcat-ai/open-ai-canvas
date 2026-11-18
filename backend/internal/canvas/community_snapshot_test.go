package canvas

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestPublicationSnapshotPreservesRichTextMultipleReferencesAndGeometry(t *testing.T) {
	payload := `{"id":"original","title":"制作画布","chatSessions":[{"content":"private-chat"}],"activeChatId":"private-chat","nodes":[{"id":"text","type":"text","title":"提示","position":{"x":130,"y":90},"width":480,"height":260,"metadata":{"content":"参考 ![](/api/resources/own-a/file) 和 ![](resource:own-b) 后继续创作","composerContent":"使用 @[node:image] 参考 /api/resources/own-a/file 和 resource:own-b","richText":{"type":"doc","content":[{"type":"image","attrs":{"src":"/api/resources/own-b/file"}},{"type":"text","text":"保留富文本"}]},"skillSnapshot":{"name":"保留技能","apiKey":"nested-key","headers":{"Authorization":"private-header"},"endpoint":"https://private.example/api"},"taskId":"private-task"}},{"id":"image","type":"image","title":"画面","position":{"x":750,"y":180},"width":640,"height":360,"metadata":{"storageKey":"resource:own-a","content":"https://private.example/image?sig=hidden","prompt":"保留提示词"}}],"connections":[{"id":"edge","fromNodeId":"text","toNodeId":"image","fromHandleId":"right","toHandleId":"left"}],"viewport":{"x":20,"y":30,"k":0.8}}`
	snapshot, refs, err := PublicationSnapshot(&model.CanvasProject{ID: "original", PayloadJSON: payload})
	if err != nil {
		t.Fatal(err)
	}
	nodes := snapshot["nodes"].([]any)
	if len(nodes) != 2 || len(snapshot["connections"].([]any)) != 1 {
		t.Fatalf("workflow changed: %#v", snapshot)
	}
	text := nodes[0].(map[string]any)
	metadata := text["metadata"].(map[string]any)
	content := metadata["content"].(string)
	if content != "参考 ![](resource:own-a) 和 ![](resource:own-b) 后继续创作" || !strings.Contains(metadata["composerContent"].(string), "@[node:image]") {
		t.Fatalf("rich text collapsed: %#v", metadata)
	}
	if text["width"] != float64(480) || text["position"].(map[string]any)["x"] != float64(130) {
		t.Fatal("node geometry changed")
	}
	if !refs["own-a"] || !refs["own-b"] || len(refs) != 2 {
		t.Fatalf("resource whitelist: %#v", refs)
	}
	encoded, _ := json.Marshal(snapshot)
	for _, forbidden := range []string{"private-chat", "private-task", "nested-key", "private-header", "private.example", "storageKey"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("snapshot leaked %q: %s", forbidden, encoded)
		}
	}
	RewritePublicationResources(snapshot, func(id string) string { return "/public/" + id })
	encoded, _ = json.Marshal(snapshot)
	if strings.Contains(string(encoded), "resource:") || !strings.Contains(string(encoded), "/public/own-a") || !strings.Contains(string(encoded), "/public/own-b") || !strings.Contains(string(encoded), "保留富文本") {
		t.Fatalf("embedded references did not follow delivery mapping: %s", encoded)
	}
}

func TestPublicationSnapshotRemovesEmbeddedPrivateURLsAndSerializedCredentials(t *testing.T) {
	metadata := map[string]any{
		"content":         "参考 https://private.example/file?sig=plain-signature 然后继续 //private.example/next?auth=private-value",
		"richText":        map[string]any{"attrs": map[string]any{"src": "//private.example/media.mp4?sig=private-value", "href": "javascript:alert(1)", "poster": "/api/private/file?sig=private-value"}},
		"composerContent": `{"name":"保留名称","api_key":"serialized-secret","images":["/api/resources/owned/file"," https://private.example/signed?auth=private-value"]}`,
	}
	payload, _ := json.Marshal(map[string]any{"id": "p", "nodes": []any{map[string]any{"id": "n", "type": "text", "metadata": metadata}}, "connections": []any{}})
	snapshot, refs, err := PublicationSnapshot(&model.CanvasProject{PayloadJSON: string(payload)})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(snapshot)
	for _, forbidden := range []string{"private.example", "plain-signature", "private-value", "serialized-secret", "javascript:", "/api/private/"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("publication leaked %q: %s", forbidden, encoded)
		}
	}
	if !refs["owned"] || !strings.Contains(string(encoded), "保留名称") || !strings.Contains(string(encoded), "然后继续") {
		t.Fatalf("valid content lost: %s; refs=%v", encoded, refs)
	}
}
