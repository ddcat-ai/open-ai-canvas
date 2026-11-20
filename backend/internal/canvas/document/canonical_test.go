package document

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCanonicalizeRetiredCanvasNodes(t *testing.T) {
	raw := []byte(`{"nodes":[
		{"id":"m","type":"markdown","title":"说明","position":{"x":2,"y":-4},"width":420,"height":320,"metadata":{"content":"# 原文\n**重点**","assetId":"asset-1","custom":{"type":"chart"}}},
		{"id":"h","type":"html","metadata":{"content":"<script>raw</script>","chartKind":"bar","storageKey":"resource:kept"}},
		{"id":"s","type":"svg","metadata":{"content":"<svg data-value=\"large\"/>"}},
		{"id":"c","type":"chart","metadata":{"content":"{\"series\":[1,2]}","chartKind":"line"}},
		{"id":"p","type":"vendor:chart","metadata":{"content":"plugin","chartKind":"custom"}},
		{"id":"t","type":"text","metadata":{"content":"text","custom":{"type":"markdown"}}}
	],"connections":[{"id":"e","fromNodeId":"m","toNodeId":"h","extra":{"type":"compare"}}],"timeline":{"clips":[{"type":"html","content":"not a node"}]},"remoteContentHash":"stale","revision":7,"extra":{"large":9007199254740993}}`)
	var original map[string]json.RawMessage
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	next, changed, err := Canonicalize(raw)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(next, &doc); err != nil {
		t.Fatal(err)
	}
	var nodes, oldNodes []map[string]json.RawMessage
	json.Unmarshal(doc["nodes"], &nodes)
	json.Unmarshal(original["nodes"], &oldNodes)
	for index := 0; index < 4; index++ {
		if stringField(nodes[index]["type"]) != "text" {
			t.Fatalf("node %d not canonical", index)
		}
		var metadata, before map[string]json.RawMessage
		json.Unmarshal(nodes[index]["metadata"], &metadata)
		json.Unmarshal(oldNodes[index]["metadata"], &before)
		if stringField(metadata["content"]) != stringField(before["content"]) {
			t.Fatalf("content changed: %s", next)
		}
		want := "plain"
		if index == 0 {
			want = "markdown"
		}
		if stringField(metadata["textFormat"]) != want {
			t.Fatalf("textFormat = %s", metadata["textFormat"])
		}
		if _, exists := metadata["chartKind"]; exists {
			t.Fatal("retired chartKind remains")
		}
		delete(metadata, "textFormat")
		delete(before, "chartKind")
		assertJSONEqual(t, metadata, before)
		delete(nodes[index], "type")
		delete(oldNodes[index], "type")
		delete(nodes[index], "metadata")
		delete(oldNodes[index], "metadata")
		assertJSONEqual(t, nodes[index], oldNodes[index])
	}
	for _, index := range []int{4, 5} {
		assertJSONEqual(t, nodes[index], oldNodes[index])
	}
	if doc["remoteContentHash"] != nil {
		t.Fatal("stale acknowledgement survived")
	}
	for _, key := range []string{"connections", "timeline", "extra", "revision"} {
		assertJSONEqual(t, doc[key], original[key])
	}
	if !strings.Contains(string(next), "9007199254740993") {
		t.Fatal("unknown large integer changed")
	}
	again, changed, err := Canonicalize(next)
	if err != nil || changed || string(again) != string(next) {
		t.Fatal("migration is not byte-idempotent")
	}
}

func TestCanonicalizeComparisonPreservesEdgeOrderAndBody(t *testing.T) {
	raw := []byte(`{"nodes":[{"id":"a","type":"image","title":"角色甲"},{"id":"b","type":"image","title":""},{"id":"compare","type":"compare"},{"id":"saved","type":"compare","metadata":{"content":"  已写正文  "}},{"id":"empty","type":"compare"}],"connections":[{"id":"1","fromNodeId":"b","toNodeId":"compare"},{"id":"2","fromNodeId":"missing","toNodeId":"compare"},{"id":"3","fromNodeId":"a","toNodeId":"compare"},{"id":"4","fromNodeId":"b","toNodeId":"compare"}]}`)
	next, _, err := Canonicalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			ID       string
			Metadata struct {
				Content    string
				TextFormat string
			}
		}
	}
	json.Unmarshal(next, &doc)
	want := "对比参考：\nb @[node:b]\nmissing @[node:missing]\n角色甲 @[node:a]\nb @[node:b]"
	if doc.Nodes[2].Metadata.Content != want {
		t.Fatalf("comparison = %q", doc.Nodes[2].Metadata.Content)
	}
	if doc.Nodes[3].Metadata.Content != "  已写正文  " {
		t.Fatal("existing content was overwritten")
	}
	if doc.Nodes[4].Metadata.Content != EmptyComparisonText {
		t.Fatal("missing comparison fallback")
	}
}

func TestCanonicalizeRejectsMalformedDocumentsWithoutDataLoss(t *testing.T) {
	for _, raw := range []string{`[1]`, `null`, `{`, `{"nodes":{}}`, `{"nodes":[null]}`, `{"nodes":[{"type":"chart","metadata":[]}]}`, `{"nodes":[{"type":"html","metadata":{"content":{"secret":"original"}}}]}`, `{"nodes":[{"id":"c","type":"compare"}],"connections":"invalid"}`} {
		if _, _, err := Canonicalize([]byte(raw)); err == nil {
			t.Fatalf("accepted malformed document: %s", raw)
		}
	}
	for _, raw := range []string{``, `{}`, `{"nodes":null}`, `{"nodes":[{"id":"plugin","type":"vendor:html","metadata":{"content":{"x":1}}}]}`} {
		got, changed, err := Canonicalize([]byte(raw))
		if err != nil || changed || string(got) != raw {
			t.Fatalf("unrelated document changed: %s err=%v", raw, err)
		}
	}
}

func TestSnapshotHashKeepsExistingAgentContract(t *testing.T) {
	base := map[string]any{"nodes": []any{map[string]any{"id": "n", "type": "text", "metadata": map[string]any{"content": "原文"}}}, "connections": []any{}}
	before, _ := json.Marshal(base)
	hash := SnapshotHash(base)
	decorated := map[string]any{"id": "canvas", "title": " ", "projectId": "", "revision": float64(8), "updatedAt": "later", "viewport": map[string]any{"x": float64(8)}, "nodes": []map[string]any{{"id": "n", "type": "text", "createdAt": "earlier", "updatedAt": "now", "metadata": map[string]any{"content": "原文"}}}, "connections": []any{}}
	if SnapshotHash(decorated) != hash {
		t.Fatal("presentation metadata changed content hash")
	}
	after, _ := json.Marshal(base)
	if string(before) != string(after) {
		t.Fatal("hash function mutated document")
	}
	decorated["unknownBusinessField"] = true
	if SnapshotHash(decorated) == hash {
		t.Fatal("unknown business field ignored")
	}
}

func assertJSONEqual(t *testing.T, left, right any) {
	t.Helper()
	a, _ := json.Marshal(left)
	b, _ := json.Marshal(right)
	var x, y any
	json.Unmarshal(a, &x)
	json.Unmarshal(b, &y)
	if !reflect.DeepEqual(x, y) {
		t.Fatalf("JSON differs:\n%s\n%s", a, b)
	}
}
