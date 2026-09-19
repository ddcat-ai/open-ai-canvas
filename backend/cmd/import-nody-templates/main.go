package main

import (
	"archive/zip"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"os"
	"path"
	"path/filepath"
	"sort"
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
	Schema        string                `json:"schema"`
	SchemaVersion int                   `json:"schemaVersion"`
	Nodes         []canvasNode          `json:"nodes"`
	Connections   []canvasConnection    `json:"connections"`
	Media         []canvasTemplateMedia `json:"media,omitempty"`
}

type canvasTemplateMedia struct {
	ID       string `json:"id"`
	NodeID   string `json:"nodeId,omitempty"`
	Kind     string `json:"kind"`
	Role     string `json:"role,omitempty"`
	Path     string `json:"path,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Bytes    int64  `json:"bytes,omitempty"`
}

type packageFile struct {
	Name  string
	Size  int64
	IsDir bool
	Open  func() (io.ReadCloser, error)
}

type multipartReader struct {
	openers []func() (io.ReadCloser, error)
	current io.ReadCloser
	index   int
}

func (reader *multipartReader) Read(buffer []byte) (int, error) {
	for reader.index < len(reader.openers) {
		if reader.current == nil {
			current, err := reader.openers[reader.index]()
			if err != nil {
				return 0, err
			}
			reader.current = current
		}
		count, err := reader.current.Read(buffer)
		if err == io.EOF {
			_ = reader.current.Close()
			reader.current = nil
			reader.index++
			if count > 0 {
				return count, nil
			}
			continue
		}
		return count, err
	}
	return 0, io.EOF
}

func (reader *multipartReader) Close() error {
	if reader.current == nil {
		return nil
	}
	err := reader.current.Close()
	reader.current = nil
	return err
}

func main() {
	archivePath := flag.String("archive", "", "Nody public previews zip path")
	packageDir := flag.String("package-dir", "", "已解压的 Nody 公共预览包目录")
	dataDir := flag.String("data-dir", "", "CANVAS_BACKEND_DATA_DIR")
	flag.Parse()
	if strings.TrimSpace(*dataDir) == "" || (strings.TrimSpace(*archivePath) == "" && strings.TrimSpace(*packageDir) == "") || (strings.TrimSpace(*archivePath) != "" && strings.TrimSpace(*packageDir) != "") {
		log.Fatal("必须配置 --data-dir，并且在 --archive 或 --package-dir 中选择一个输入")
	}

	var files []packageFile
	var closePackage func() error
	if strings.TrimSpace(*archivePath) != "" {
		archive, err := zip.OpenReader(*archivePath)
		if err != nil {
			log.Fatal(err)
		}
		files = zipPackageFiles(archive)
		closePackage = archive.Close
	} else {
		var err error
		files, err = directoryPackageFiles(*packageDir)
		if err != nil {
			log.Fatal(err)
		}
	}
	if closePackage != nil {
		defer closePackage()
	}

	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: *dataDir})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		log.Fatal(err)
	}

	summaries := readSummaries(files)
	previews := selectedPreviewFiles(files)
	count := 0
	ids := make([]string, 0, len(previews))
	for id := range previews {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	mediaCount := 0
	for _, id := range ids {
		file := previews[id]
		var preview nodyPreview
		if err := readJSON(file, &preview); err != nil {
			log.Printf("跳过 %s：%v", file.Name, err)
			continue
		}
		summary := summaries[id]
		media, mediaByName, err := installTemplateMedia(files, id, *dataDir)
		if err != nil {
			log.Printf("跳过 %s：安装模板媒体失败：%v", id, err)
			continue
		}
		document := convertPreview(preview, mediaByName, id)
		document.Media = media
		assignMediaNodes(&document)
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
			Description:    "从 NodyHub 公共预览包导入的画布工作流；模板节点保留为空输入，图片和视频作为模板预览媒体提供。",
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
		version := model.CanvasTemplateVersion{ID: id, TemplateID: id, Version: 1, SchemaVersion: document.SchemaVersion, DocumentJSON: string(documentJSON), CreatedBy: "nodyhub-import", CreatedAt: now}
		if err := upsert(db, &template, &version); err != nil {
			log.Fatal(err)
		}
		count++
		mediaCount += len(media)
	}
	log.Printf("已导入 %d 个 NodyHub 公共预览模板，安装 %d 个模板媒体文件", count, mediaCount)
}

func zipPackageFiles(archive *zip.ReadCloser) []packageFile {
	files := make([]packageFile, 0, len(archive.File))
	for _, rawFile := range archive.File {
		file := rawFile
		files = append(files, packageFile{
			Name:  file.Name,
			Size:  int64(file.UncompressedSize64),
			IsDir: file.FileInfo().IsDir(),
			Open:  file.Open,
		})
	}
	return files
}

func directoryPackageFiles(root string) ([]packageFile, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(root); err != nil {
		return nil, err
	} else if !info.IsDir() {
		return nil, fmt.Errorf("模板包目录不是目录：%s", root)
	}
	files := make([]packageFile, 0)
	err = filepath.WalkDir(root, func(fullPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		relative, err := filepath.Rel(root, fullPath)
		if err != nil {
			return err
		}
		filePath := fullPath
		files = append(files, packageFile{
			Name: filepath.ToSlash(relative),
			Size: info.Size(),
			Open: func() (io.ReadCloser, error) { return os.Open(filePath) },
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return combinePackageParts(files), nil
}

func combinePackageParts(files []packageFile) []packageFile {
	regular := make([]packageFile, 0, len(files))
	parts := map[string][]packageFile{}
	for _, file := range files {
		marker := strings.LastIndex(file.Name, ".part-")
		if marker < 0 || marker+6 >= len(file.Name) || !allDigits(file.Name[marker+6:]) {
			regular = append(regular, file)
			continue
		}
		base := file.Name[:marker]
		parts[base] = append(parts[base], file)
	}
	for name, chunks := range parts {
		sort.Slice(chunks, func(left, right int) bool { return chunks[left].Name < chunks[right].Name })
		size := int64(0)
		openers := make([]func() (io.ReadCloser, error), 0, len(chunks))
		for _, chunk := range chunks {
			size += chunk.Size
			openers = append(openers, chunk.Open)
		}
		partOpeners := openers
		regular = append(regular, packageFile{Name: name, Size: size, Open: func() (io.ReadCloser, error) {
			return &multipartReader{openers: partOpeners}, nil
		}})
	}
	return regular
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func hasPathSegment(name string, segment string) bool {
	clean := "/" + strings.Trim(name, "/") + "/"
	return strings.Contains(clean, "/"+strings.Trim(segment, "/")+"/")
}

func hasPathSuffix(name string, suffix string) bool {
	cleanName := "/" + strings.Trim(name, "/")
	cleanSuffix := "/" + strings.Trim(suffix, "/")
	return strings.HasSuffix(cleanName, cleanSuffix)
}

func selectedPreviewFiles(files []packageFile) map[string]packageFile {
	result := map[string]packageFile{}
	for _, file := range files {
		if !hasPathSegment(file.Name, "previews") {
			continue
		}
		name := path.Base(file.Name)
		if name != "preview.json" && name != "offline-preview.json" {
			continue
		}
		id := path.Base(path.Dir(file.Name))
		if name == "offline-preview.json" || result[id].Name == "" {
			result[id] = file
		}
	}
	return result
}

func readSummaries(files []packageFile) map[string]nodyTemplateSummary {
	result := map[string]nodyTemplateSummary{}
	for _, file := range files {
		if !hasPathSuffix(file.Name, "/metadata/template-summary.json") {
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

func readJSON(file packageFile, target any) error {
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	return json.NewDecoder(reader).Decode(target)
}

func convertPreview(preview nodyPreview, mediaByName map[string]string, templateID string) canvasDocument {
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
			if mediaIDs := mediaIDsForNode(node.Data, mediaByName); len(mediaIDs) > 0 {
				metadata["templateMediaIds"] = mediaIDs
				metadata["templateMediaTemplateId"] = templateID
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
	return canvasDocument{Schema: "yingce.canvas-template", SchemaVersion: 2, Nodes: nodes, Connections: connections}
}

func installTemplateMedia(files []packageFile, templateID string, dataDir string) ([]canvasTemplateMedia, map[string]string, error) {
	entries := make([]packageFile, 0)
	for _, file := range files {
		parts := strings.Split(strings.TrimSuffix(file.Name, "/"), "/")
		assetsIndex := -1
		for index, part := range parts {
			if part == "assets" {
				assetsIndex = index
				break
			}
		}
		if assetsIndex < 0 || assetsIndex+1 >= len(parts) || parts[assetsIndex+1] != templateID || len(parts) != assetsIndex+3 || file.IsDir {
			continue
		}
		if mediaKind(path.Ext(file.Name)) == "" {
			continue
		}
		entries = append(entries, file)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })

	mediaRoot := filepath.Join(dataDir, "template-media")
	if err := os.MkdirAll(mediaRoot, 0o750); err != nil {
		return nil, nil, err
	}
	finalDir := filepath.Join(mediaRoot, templateID)
	stageDir := filepath.Join(mediaRoot, "."+templateID+".importing")
	if err := os.RemoveAll(stageDir); err != nil {
		return nil, nil, err
	}
	if err := os.MkdirAll(stageDir, 0o750); err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(stageDir)

	media := make([]canvasTemplateMedia, 0, len(entries))
	mediaByName := make(map[string]string, len(entries))
	for _, file := range entries {
		name := path.Base(file.Name)
		if _, exists := mediaByName[name]; exists {
			return nil, nil, fmt.Errorf("模板媒体文件名重复：%s", name)
		}
		kind := mediaKind(path.Ext(name))
		mimeType := mime.TypeByExtension(strings.ToLower(path.Ext(name)))
		item := canvasTemplateMedia{
			ID:       name,
			Kind:     kind,
			Role:     mediaRole(name),
			Path:     filepath.ToSlash(filepath.Join("template-media", templateID, name)),
			MimeType: mimeType,
			Bytes:    file.Size,
		}
		reader, err := file.Open()
		if err != nil {
			return nil, nil, err
		}
		output, err := os.OpenFile(filepath.Join(stageDir, name), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
		if err != nil {
			reader.Close()
			return nil, nil, err
		}
		_, copyErr := io.Copy(output, reader)
		closeErr := output.Close()
		readerErr := reader.Close()
		if copyErr != nil {
			return nil, nil, copyErr
		}
		if closeErr != nil {
			return nil, nil, closeErr
		}
		if readerErr != nil {
			return nil, nil, readerErr
		}
		media = append(media, item)
		mediaByName[name] = name
	}
	if err := os.RemoveAll(finalDir); err != nil {
		return nil, nil, err
	}
	if err := os.Rename(stageDir, finalDir); err != nil {
		return nil, nil, err
	}
	return media, mediaByName, nil
}

func mediaKind(extension string) string {
	switch strings.ToLower(extension) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov":
		return "video"
	default:
		return ""
	}
}

func mediaRole(name string) string {
	if strings.Contains(strings.ToLower(name), "_cover_") {
		return "cover"
	}
	return "node"
}

func mediaIDsForNode(data map[string]any, mediaByName map[string]string) []string {
	values := make([]string, 0)
	collectMediaReferences(data, &values)
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		name := path.Base(strings.TrimSpace(value))
		id, ok := mediaByName[name]
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func collectMediaReferences(value any, result *[]string) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "template_demo_url" || key == "template_demo_urls" || key == "template_demo_video_urls" {
				collectMediaStrings(child, result)
				continue
			}
			collectMediaReferences(child, result)
		}
	case []any:
		for _, child := range typed {
			collectMediaReferences(child, result)
		}
	}
}

func collectMediaStrings(value any, result *[]string) {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			*result = append(*result, typed)
		}
	case []any:
		for _, child := range typed {
			collectMediaStrings(child, result)
		}
	}
}

func assignMediaNodes(document *canvasDocument) {
	for index := range document.Media {
		for _, node := range document.Nodes {
			values, ok := node.Metadata["templateMediaIds"].([]string)
			if !ok {
				continue
			}
			for _, mediaID := range values {
				if mediaID == document.Media[index].ID {
					document.Media[index].NodeID = node.ID
					break
				}
			}
			if document.Media[index].NodeID != "" {
				break
			}
		}
	}
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
