// Package document owns pure transformations at the canvas persistence boundary.
package document

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

const EmptyComparisonText = "图片对比已移到预览：选中两张图片后使用“对比图片”。"

// Canonicalize replaces retired presentation node types in the document's own
// nodes array. Nested tool payloads, media metadata and unknown plugin nodes are
// opaque; they must not be recursively interpreted as canvas nodes.
func Canonicalize(raw []byte) ([]byte, bool, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return raw, false, nil
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil || doc == nil {
		return nil, false, fmt.Errorf("画布文档不是有效的 JSON 对象")
	}
	if len(doc["nodes"]) == 0 || bytes.Equal(bytes.TrimSpace(doc["nodes"]), []byte("null")) {
		return raw, false, nil
	}
	var nodes []map[string]json.RawMessage
	if err := json.Unmarshal(doc["nodes"], &nodes); err != nil {
		return nil, false, fmt.Errorf("画布 nodes 格式无效：%w", err)
	}
	titles := make(map[string]string, len(nodes))
	for _, node := range nodes {
		if node == nil {
			return nil, false, fmt.Errorf("画布 nodes 包含无效节点")
		}
		if id := stringField(node["id"]); id != "" {
			titles[id] = stringField(node["title"])
		}
	}
	var connections []map[string]json.RawMessage
	connectionsRead := false
	changed := false
	for _, node := range nodes {
		kind := stringField(node["type"])
		format := "plain"
		switch kind {
		case "markdown":
			format = "markdown"
		case "html", "svg", "chart", "compare":
		default:
			continue
		}
		metadata := map[string]json.RawMessage{}
		if value := bytes.TrimSpace(node["metadata"]); len(value) != 0 && !bytes.Equal(value, []byte("null")) {
			if err := json.Unmarshal(value, &metadata); err != nil || metadata == nil {
				return nil, false, fmt.Errorf("待迁移节点 %q 的 metadata 格式无效", stringField(node["id"]))
			}
		}
		if value := bytes.TrimSpace(metadata["content"]); len(value) != 0 && !bytes.Equal(value, []byte("null")) {
			var content string
			if err := json.Unmarshal(value, &content); err != nil {
				return nil, false, fmt.Errorf("待迁移节点 %q 的 content 不是字符串，未覆盖原文", stringField(node["id"]))
			}
		}
		if kind == "compare" && emptyContent(metadata["content"]) {
			if !connectionsRead {
				if value := bytes.TrimSpace(doc["connections"]); len(value) != 0 && !bytes.Equal(value, []byte("null")) {
					if err := json.Unmarshal(value, &connections); err != nil {
						return nil, false, fmt.Errorf("画布 connections 格式无效：%w", err)
					}
				}
				connectionsRead = true
			}
			lines := []string{}
			id := stringField(node["id"])
			for _, edge := range connections {
				from := stringField(edge["fromNodeId"])
				if id == "" || stringField(edge["toNodeId"]) != id || from == "" {
					continue
				}
				title := titles[from]
				if title == "" {
					title = from
				}
				lines = append(lines, title+" @[node:"+from+"]")
			}
			content := EmptyComparisonText
			if len(lines) > 0 {
				content = "对比参考：\n" + strings.Join(lines, "\n")
			}
			metadata["content"], _ = json.Marshal(content)
		}
		delete(metadata, "chartKind")
		metadata["textFormat"], _ = json.Marshal(format)
		node["metadata"], _ = json.Marshal(metadata)
		node["type"] = json.RawMessage(`"text"`)
		changed = true
	}
	if !changed {
		return raw, false, nil
	}
	doc["nodes"], _ = json.Marshal(nodes)
	// This is a browser cache acknowledgement, never a server content hash.
	delete(doc, "remoteContentHash")
	encoded, err := json.Marshal(doc)
	return encoded, true, err
}

func stringField(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}

func emptyContent(raw json.RawMessage) bool {
	value := bytes.TrimSpace(raw)
	return len(value) == 0 || bytes.Equal(value, []byte("null")) || bytes.Equal(value, []byte(`""`))
}

// SnapshotHash is the existing Agent mutation/undo hash contract. Presentation
// timestamps and viewport do not participate; unknown business fields still do.
func SnapshotHash(doc map[string]any) string {
	content := make(map[string]any, len(doc))
	for key, value := range doc {
		switch key {
		case "id", "viewport", "updatedAt", "revision", "createdAt":
			continue
		case "title", "projectId":
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
				continue
			}
		}
		content[key] = value
	}
	for _, key := range []string{"nodes", "connections"} {
		if value, exists := content[key]; !exists || value == nil {
			content[key] = []any{}
		}
	}
	content["nodes"] = nodesWithoutTimestamps(content["nodes"])
	encoded, _ := json.Marshal(content)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func nodesWithoutTimestamps(value any) any {
	items, ok := value.([]any)
	if !ok {
		if typed, isMaps := value.([]map[string]any); isMaps {
			items = make([]any, len(typed))
			for index, node := range typed {
				items[index] = node
			}
		} else {
			return value
		}
	}
	projected := make([]any, len(items))
	for index, item := range items {
		node, isMap := item.(map[string]any)
		if !isMap {
			projected[index] = item
			continue
		}
		copy := make(map[string]any, len(node))
		for key, field := range node {
			if key != "createdAt" && key != "updatedAt" {
				copy[key] = field
			}
		}
		projected[index] = copy
	}
	return projected
}
