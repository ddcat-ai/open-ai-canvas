package main

import (
	"archive/zip"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type nodyTemplateSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Tags  string `json:"tags"`
}

type nodyPreview struct {
	Nodes []nodyNode `json:"nodes"`
	Edges []nodyEdge `json:"edges"`
}

type nodyNode struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Position nodyPosition   `json:"position"`
	Data     map[string]any `json:"data"`
	Width    float64        `json:"width"`
	Height   float64        `json:"height"`
}

type nodyPosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type nodyEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type canvasNode struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Title    string         `json:"title"`
	Position nodyPosition   `json:"position"`
	Width    float64        `json:"width"`
	Height   float64        `json:"height"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type canvasConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type canvasDocument struct {
	Schema        string             `json:"schema"`
	SchemaVersion int                `json:"schemaVersion"`
	Nodes         []canvasNode       `json:"nodes"`
	Connections   []canvasConnection `json:"connections"`
}

func main() {
	archivePath := flag.String("archive", "", "Nody public previews zip path")
	dataDir := flag.String("data-dir", "", "CANVAS_BACKEND_DATA_DIR")
	flag.Parse()
	if strings.TrimSpace(*archivePath) == "" || strings.TrimSpace(*dataDir) == "" {
		log.Fatal("必须配置 --archive 和 --data-dir")
	}

	archive, err := zip.OpenReader(*archivePath)
	if err != nil {
		log.Fatal(err)
	}
	defer archive.Close()

	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: *dataDir})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		log.Fatal(err)
	}

	summaries := readSummaries(archive)
	count := 0
	for _, file := range archive.File {
		if !strings.HasSuffix(file.Name, "/preview.json") || !strings.Contains(file.Name, "/previews/") {
			continue
		}
		var preview nodyPreview
		if err := readJSON(file, &preview); err != nil {
			log.Printf("跳过 %s：%v", file.Name, err)
			continue
		}
		id := filepath.Base(filepath.Dir(file.Name))
		summary := summaries[id]
		document := convertPreview(preview)
		documentJSON, err := json.Marshal(document)
		if err != nil {
			log.Printf("跳过 %s：序列化失败：%v", id, err)
			continue
		}
		title := summary.Title
		if title == "" {
			title = "Nody 模板 " + id[:min(8, len(id))]
		}
		tags, _ := json.Marshal(splitTags(summary.Tags))
		now := time.Now().UTC()
		template := model.CanvasTemplate{
			ID:             id,
			OwnerID:        "nodyhub-import",
			Title:          title,
			Description:    "从 NodyHub 公共预览包导入的画布工作流；媒体预览已转换为空输入节点。",
			Category:       categoryForTags(summary.Tags),
			TagsJSON:       string(tags),
			Status:         "published",
			Visibility:     "public",
			CurrentVersion: 1,
			CreatedBy:      "nodyhub-import",
			PublishedBy:    "nodyhub-import",
			PublishedAt:    &now,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		// Reuse the stable template UUID for its first version. The version table has
		// its own primary key, so this stays within the model's 36-character limit.
		version := model.CanvasTemplateVersion{ID: id, TemplateID: id, Version: 1, SchemaVersion: 1, DocumentJSON: string(documentJSON), CreatedBy: "nodyhub-import", CreatedAt: now}
		if err := upsert(db, &template, &version); err != nil {
			log.Fatal(err)
		}
		count++
	}
	log.Printf("已导入 %d 个 NodyHub 公共预览模板", count)
}

func readSummaries(archive *zip.ReadCloser) map[string]nodyTemplateSummary {
	result := map[string]nodyTemplateSummary{}
	for _, file := range archive.File {
		if !strings.HasSuffix(file.Name, "/metadata/template-summary.json") {
			continue
		}
		var summaries []nodyTemplateSummary
		if err := readJSON(file, &summaries); err != nil {
			log.Printf("读取模板摘要失败：%v", err)
			return result
		}
		for _, summary := range summaries {
			result[summary.ID] = summary
		}
	}
	return result
}

func readJSON(file *zip.File, target any) error {
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	return json.NewDecoder(reader).Decode(target)
}

func convertPreview(preview nodyPreview) canvasDocument {
	supported := map[string]bool{}
	nodes := make([]canvasNode, 0, len(preview.Nodes))
	for _, node := range preview.Nodes {
		canvasType := nodyNodeType(node.Type)
		if canvasType == "" {
			continue
		}
		title := stringValue(node.Data["label"])
		if title == "" {
			title = node.Type
		}
		width, height := node.Width, node.Height
		if width <= 0 {
			width = 420
		}
		if height <= 0 {
			height = 260
		}
		metadata := map[string]any{"status": "idle"}
		if canvasType == "text" {
			content := firstString(node.Data, "value", "content", "prompt")
			if content != "" {
				metadata["content"] = content
				metadata["prompt"] = content
				metadata["status"] = "success"
			}
		}
		if canvasType == "image" || canvasType == "video" {
			metadata["generationMode"] = canvasType
			if prompt := firstString(node.Data, "prompt"); prompt != "" && prompt != "需要获取模板..." {
				metadata["prompt"] = prompt
				metadata["composerContent"] = prompt
			}
			if config, ok := node.Data["config"].(map[string]any); ok {
				if modelName := stringValue(config["model"]); modelName != "" {
					metadata["model"] = modelName
				}
				if seconds := numberValue(config["duration"]); seconds > 0 {
					metadata["seconds"] = strconv.FormatFloat(seconds, 'f', -1, 64)
				}
			}
		}
		if canvasType == "frame" {
			metadata = map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": width, "expandedHeight": height}}
		}
		nodes = append(nodes, canvasNode{ID: node.ID, Type: canvasType, Title: title, Position: node.Position, Width: width, Height: height, Metadata: metadata})
		supported[node.ID] = true
	}
	connections := make([]canvasConnection, 0, len(preview.Edges))
	for index, edge := range preview.Edges {
		if !supported[edge.Source] || !supported[edge.Target] {
			continue
		}
		connections = append(connections, canvasConnection{ID: fmt.Sprintf("nody-edge-%d", index), FromNodeID: edge.Source, ToNodeID: edge.Target})
	}
	return canvasDocument{Schema: "yingce.canvas-template", SchemaVersion: 1, Nodes: nodes, Connections: connections}
}

func nodyNodeType(value string) string {
	switch value {
	case "image", "imageGeneration":
		return "image"
	case "video", "videoGeneration":
		return "video"
	case "textInput", "textGeneration", "stickyNote":
		return "text"
	case "group":
		return "frame"
	default:
		return ""
	}
}

func firstString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func numberValue(value any) float64 {
	if number, ok := value.(float64); ok {
		return number
	}
	return 0
}

func splitTags(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '，' })
}

func categoryForTags(tags string) string {
	value := strings.ToLower(tags)
	if strings.Contains(value, "电商") || strings.Contains(value, "亚马逊") {
		return "commerce"
	}
	if strings.Contains(value, "短剧") || strings.Contains(value, "广告") {
		return "storyboard"
	}
	if strings.Contains(value, "电影") || strings.Contains(value, "视频") {
		return "video"
	}
	return "image"
}

func upsert(db *gorm.DB, template *model.CanvasTemplate, version *model.CanvasTemplateVersion) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("template_id = ?", template.ID).Delete(&model.CanvasTemplateVersion{}).Error; err != nil {
			return err
		}
		if err := tx.Save(template).Error; err != nil {
			return err
		}
		return tx.Create(version).Error
	})
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
