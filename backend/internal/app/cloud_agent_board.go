package app

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// canvas_build_board 把一份分镜脚本一次展开成制作看板。布局是确定性的服务端计算，
// 不让模型 20 个一批地摆坐标：同样的分镜得到同样的看板，重复调用只补缺失的占位。
const (
	cloudAgentBoardMaxAssets   = 30
	cloudAgentBoardMaxActs     = 12
	cloudAgentBoardColumns     = 6
	cloudAgentBoardAssetWidth  = 360.0
	cloudAgentBoardAssetHeight = 203.0
	cloudAgentBoardShotWidth   = 400.0
	cloudAgentBoardShotHeight  = 225.0
	cloudAgentBoardGap         = 32.0
	cloudAgentBoardFramePad    = 24.0
	cloudAgentBoardFrameHeader = 36.0
)

// 背板颜色只存语义名，前端按主题把它映射成具体颜色。
var cloudAgentBoardFrameColors = []string{"blue", "green", "violet", "amber", "rose", "teal"}

type cloudAgentBoardArgs struct {
	SnapshotHash     string `json:"snapshotHash"`
	StoryboardNodeID string `json:"storyboardNodeId"`
	Overview         string `json:"overview"`
	Assets           []struct {
		ID       string   `json:"id"`
		Category string   `json:"category"`
		Title    string   `json:"title"`
		Prompt   string   `json:"prompt"`
		RowIDs   []string `json:"rowIds"`
	} `json:"assets"`
	Keyframes *bool `json:"keyframes"`
	Videos    *bool `json:"videos"`
	Acts      []struct {
		Label  string   `json:"label"`
		RowIDs []string `json:"rowIds"`
	} `json:"acts"`
}

type cloudAgentBoardPlan struct {
	Canvas     *model.CanvasProject
	Document   map[string]any
	BeforeHash string
	Preview    cloudAgentApprovalPreview
	Counts     map[string]int
	Rows       []map[string]any
	Assets     []string
	Missing    []string
}

func cloudAgentBoardRowPrompt(row map[string]any, primary string, extras ...string) string {
	if text := strings.TrimSpace(stringValue(row[primary])); text != "" {
		return text
	}
	parts := []string{}
	for _, key := range append([]string{"plotDescription"}, extras...) {
		if text := strings.TrimSpace(stringValue(row[key])); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}

func prepareCloudAgentBuildBoard(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentBoardPlan, error) {
	var args cloudAgentBoardArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.SnapshotHash) == "" {
		return nil, cloudAgentFieldError("snapshotHash", "required", "搭建看板需要先读取画布并传入 snapshotHash")
	}
	if len(args.Assets) > cloudAgentBoardMaxAssets {
		return nil, cloudAgentFieldError("assets", "item_count", fmt.Sprintf("资产最多 %d 个", cloudAgentBoardMaxAssets))
	}
	if len(args.Acts) > cloudAgentBoardMaxActs {
		return nil, cloudAgentFieldError("acts", "item_count", fmt.Sprintf("分组最多 %d 个", cloudAgentBoardMaxActs))
	}
	if utf8.RuneCountInString(args.Overview) > 4000 {
		return nil, cloudAgentFieldError("overview", "length_exceeded", "总控说明最多 4000 字")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != strings.TrimSpace(args.SnapshotHash) {
		return nil, &cloudAgentFieldArgumentError{
			error: &cloudAgentArgumentError{creationConflict("画布已变化，本次未搭建看板；请重新读取画布后再调用")},
			Field: "snapshotHash", Issue: "stale_snapshot",
		}
	}
	nodes := creationMaps(doc["nodes"])
	edges := creationMaps(doc["connections"])
	storyboard := cloudAgentNodeByID(nodes, args.StoryboardNodeID)
	if storyboard == nil || stringValue(storyboard["type"]) != "script" {
		return nil, cloudAgentFieldError("storyboardNodeId", "not_found", "分镜脚本节点不存在；请先用 canvas_create_storyboard 建好分镜")
	}
	storyMeta, _ := storyboard["metadata"].(map[string]any)
	table, _ := storyMeta["storyboard"].(map[string]any)
	rows := creationMaps(table["rows"])
	if len(rows) == 0 {
		return nil, cloudAgentFieldError("storyboardNodeId", "invalid_value", "分镜脚本里还没有镜头行")
	}
	rowIndex := map[string]int{}
	for index, row := range rows {
		rowIndex[stringValue(row["id"])] = index
	}
	existing := map[string]bool{}
	for _, node := range nodes {
		existing[stringValue(node["id"])] = true
	}
	assetIDs := map[string]bool{}
	for index, asset := range args.Assets {
		field := func(name string) string { return fmt.Sprintf("assets[%d].%s", index, name) }
		if err := validateCloudAgentID(asset.ID, "资产节点 ID", 80); err != nil {
			return nil, cloudAgentFieldError(field("id"), "invalid_value", cloudAgentSafeToolError(err))
		}
		if assetIDs[asset.ID] {
			return nil, cloudAgentFieldError(field("id"), "duplicate", "资产节点 ID 重复")
		}
		assetIDs[asset.ID] = true
		if asset.Category != "character" && asset.Category != "environment" && asset.Category != "prop" {
			return nil, cloudAgentFieldError(field("category"), "invalid_value", "资产类别只能是 character、environment 或 prop")
		}
		if strings.TrimSpace(asset.Title) == "" || utf8.RuneCountInString(asset.Title) > 120 {
			return nil, cloudAgentFieldError(field("title"), "invalid_value", "资产名不能为空且不超过 120 字")
		}
		if strings.TrimSpace(asset.Prompt) == "" || utf8.RuneCountInString(asset.Prompt) > 4000 {
			return nil, cloudAgentFieldError(field("prompt"), "invalid_value", "资产提示词不能为空且不超过 4000 字")
		}
		for position, rowID := range asset.RowIDs {
			if _, ok := rowIndex[rowID]; !ok {
				return nil, cloudAgentFieldError(fmt.Sprintf("assets[%d].rowIds[%d]", index, position), "not_found", "镜头行不存在；请用 canvas_read_storyboard 返回的 rowId")
			}
		}
	}
	actOfRow := map[string]int{}
	for index, act := range args.Acts {
		if strings.TrimSpace(act.Label) == "" || utf8.RuneCountInString(act.Label) > 60 {
			return nil, cloudAgentFieldError(fmt.Sprintf("acts[%d].label", index), "invalid_value", "分组名不能为空且不超过 60 字")
		}
		for position, rowID := range act.RowIDs {
			if _, ok := rowIndex[rowID]; !ok {
				return nil, cloudAgentFieldError(fmt.Sprintf("acts[%d].rowIds[%d]", index, position), "not_found", "镜头行不存在；请用 canvas_read_storyboard 返回的 rowId")
			}
			if _, taken := actOfRow[rowID]; taken {
				return nil, cloudAgentFieldError(fmt.Sprintf("acts[%d].rowIds[%d]", index, position), "duplicate", "一个镜头行只能属于一个分组")
			}
			actOfRow[rowID] = index
		}
	}
	keyframes := args.Keyframes == nil || *args.Keyframes
	videos := args.Videos == nil || *args.Videos

	// 看板放在现有内容右侧，保证不压住用户已经摆好的节点。
	originX, originY := 80.0, 80.0
	if position, ok := storyboard["position"].(map[string]any); ok {
		originY, _ = position["y"].(float64)
	}
	for _, node := range cloudAgentLayoutNodes(doc) {
		width := node.Width
		if width <= 0 {
			width = 340
		}
		originX = math.Max(originX, node.X+width+200)
	}
	plan := &cloudAgentBoardPlan{Canvas: canvas, Document: doc, BeforeHash: beforeHash, Counts: map[string]int{}}
	add := func(node map[string]any) {
		nodes = append(nodes, node)
		existing[stringValue(node["id"])] = true
	}
	newNode := func(id, nodeType, title string, x, y, width, height float64, metadata map[string]any) map[string]any {
		return creationAddedNode(CreationCanvasOp{Type: "add_node", ID: id, NodeType: nodeType, Title: truncateRunes(title, 200), X: &x, Y: &y, Width: &width, Height: &height, Metadata: metadata})
	}
	mediaMetadata := func(nodeType, prompt string) map[string]any {
		descriptor, _ := cloudAgentNodeCapabilityForType(nodeType)
		return descriptor.Metadata(prompt)
	}
	frameNode := func(id, title, color string, x, y, width, height float64) map[string]any {
		return newNode(id, "frame", title, x, y, width, height, map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": width, "expandedHeight": height, "color": color}})
	}

	cursorX := originX
	overviewHeight := 0.0
	if text := strings.TrimSpace(args.Overview); text != "" {
		id := cloudAgentID(userID, fmt.Sprintf("board:%s:%s:overview", canvasID, args.StoryboardNodeID))
		if !existing[id] {
			descriptor, _ := cloudAgentNodeCapabilityForType("markdown")
			add(newNode(id, "markdown", "总控 · "+truncateRunes(stringValue(storyboard["title"]), 60), cursorX, originY, 420, 320, descriptor.Metadata(text)))
			plan.Counts["overview"]++
		}
		cursorX += 420 + 80
		overviewHeight = 320
	}
	// 资产按类别分三列，每列一个背板。
	assetColumnHeight := 0.0
	columnX := cursorX
	for _, category := range []struct{ key, label string }{{"character", "人物"}, {"environment", "场景"}, {"prop", "道具"}} {
		members := []int{}
		for index, asset := range args.Assets {
			if asset.Category == category.key && !existing[asset.ID] {
				members = append(members, index)
			}
		}
		if len(members) == 0 {
			continue
		}
		frameID := cloudAgentID(userID, fmt.Sprintf("board:%s:%s:assets:%s", canvasID, args.StoryboardNodeID, category.key))
		height := cloudAgentBoardFrameHeader + cloudAgentBoardFramePad*2 + float64(len(members))*cloudAgentBoardAssetHeight + float64(len(members)-1)*cloudAgentBoardGap
		width := cloudAgentBoardAssetWidth + cloudAgentBoardFramePad*2
		if !existing[frameID] {
			add(frameNode(frameID, "资产 · "+category.label, "slate", columnX, originY, width, height))
			plan.Counts["frames"]++
		}
		for position, index := range members {
			asset := args.Assets[index]
			metadata := mediaMetadata("image", asset.Prompt)
			metadata["assetCategory"] = asset.Category
			node := newNode(asset.ID, "image", asset.Title, columnX+cloudAgentBoardFramePad, originY+cloudAgentBoardFrameHeader+cloudAgentBoardFramePad+float64(position)*(cloudAgentBoardAssetHeight+cloudAgentBoardGap), cloudAgentBoardAssetWidth, cloudAgentBoardAssetHeight, metadata)
			node["parentId"] = frameID
			add(node)
			plan.Assets = append(plan.Assets, asset.ID)
			plan.Counts["assets"]++
		}
		assetColumnHeight = math.Max(assetColumnHeight, height)
		columnX += width + 40
	}

	// 镜头矩阵：每个分组一条横向背板，背板里每格是"关键帧在上、视频在下"。
	type actGroup struct {
		label string
		rows  []int
	}
	groups := []actGroup{}
	for _, act := range args.Acts {
		group := actGroup{label: act.Label}
		for _, rowID := range act.RowIDs {
			group.rows = append(group.rows, rowIndex[rowID])
		}
		groups = append(groups, group)
	}
	leftover := actGroup{label: "其他镜头"}
	for index, row := range rows {
		if _, grouped := actOfRow[stringValue(row["id"])]; !grouped {
			leftover.rows = append(leftover.rows, index)
		}
	}
	if len(leftover.rows) > 0 {
		if len(groups) == 0 {
			leftover.label = ""
		}
		groups = append(groups, leftover)
	}
	cellHeight := 0.0
	if keyframes {
		cellHeight += cloudAgentBoardShotHeight
	}
	if videos {
		if cellHeight > 0 {
			cellHeight += 16
		}
		cellHeight += cloudAgentBoardShotHeight
	}
	cursorY := originY + math.Max(overviewHeight, assetColumnHeight) + 160
	keyframeOfRow := map[string]string{}
	videoOfRow := map[string]string{}
	if cellHeight > 0 {
		for groupIndex, group := range groups {
			framed := group.label != ""
			columns := min(cloudAgentBoardColumns, len(group.rows))
			lines := int(math.Ceil(float64(len(group.rows)) / float64(cloudAgentBoardColumns)))
			innerX, innerY := originX, cursorY
			frameID := ""
			if framed {
				frameID = cloudAgentID(userID, fmt.Sprintf("board:%s:%s:act:%d", canvasID, args.StoryboardNodeID, groupIndex))
				width := float64(columns)*cloudAgentBoardShotWidth + float64(columns-1)*cloudAgentBoardGap + cloudAgentBoardFramePad*2
				height := float64(lines)*cellHeight + float64(lines-1)*cloudAgentBoardGap*2 + cloudAgentBoardFramePad*2 + cloudAgentBoardFrameHeader
				if !existing[frameID] {
					add(frameNode(frameID, group.label, cloudAgentBoardFrameColors[groupIndex%len(cloudAgentBoardFrameColors)], originX, cursorY, width, height))
					plan.Counts["frames"]++
				}
				innerX, innerY = originX+cloudAgentBoardFramePad, cursorY+cloudAgentBoardFrameHeader+cloudAgentBoardFramePad
			}
			for position, rowPosition := range group.rows {
				row := rows[rowPosition]
				rowID := stringValue(row["id"])
				shot := fmt.Sprintf("S%02d", rowPosition+1)
				x := innerX + float64(position%cloudAgentBoardColumns)*(cloudAgentBoardShotWidth+cloudAgentBoardGap)
				y := innerY + float64(position/cloudAgentBoardColumns)*(cellHeight+cloudAgentBoardGap*2)
				if keyframes && stringValue(row["imageNodeId"]) == "" {
					prompt := cloudAgentBoardRowPrompt(row, "imageGenerationPrompt", "shotSize", "camera", "lightingAndAtmosphere")
					id := cloudAgentID(userID, fmt.Sprintf("board:%s:%s:keyframe:%s", canvasID, args.StoryboardNodeID, rowID))
					if prompt == "" {
						plan.Missing = append(plan.Missing, shot+" 关键帧")
					} else if !existing[id] {
						node := newNode(id, "image", shot+" · 关键帧", x, y, cloudAgentBoardShotWidth, cloudAgentBoardShotHeight, mediaMetadata("image", prompt))
						if frameID != "" {
							node["parentId"] = frameID
						}
						add(node)
						keyframeOfRow[rowID] = id
						plan.Counts["keyframes"]++
					}
				}
				if videos && stringValue(row["videoNodeId"]) == "" {
					prompt := cloudAgentBoardRowPrompt(row, "videoMotionPrompt", "camera", "motion", "performanceBlocking")
					id := cloudAgentID(userID, fmt.Sprintf("board:%s:%s:video:%s", canvasID, args.StoryboardNodeID, rowID))
					videoY := y
					if keyframes {
						videoY = y + cloudAgentBoardShotHeight + 16
					}
					if prompt == "" {
						plan.Missing = append(plan.Missing, shot+" 视频")
					} else if !existing[id] {
						metadata := mediaMetadata("video", prompt)
						if keyframeID := keyframeOfRow[rowID]; keyframeID != "" {
							metadata["videoStartFrameNodeId"] = keyframeID
						}
						node := newNode(id, "video", shot+" · 视频", x, videoY, cloudAgentBoardShotWidth, cloudAgentBoardShotHeight, metadata)
						if frameID != "" {
							node["parentId"] = frameID
						}
						add(node)
						videoOfRow[rowID] = id
						plan.Counts["videos"]++
					}
				}
			}
			height := float64(lines)*cellHeight + float64(lines-1)*cloudAgentBoardGap*2
			if framed {
				height += cloudAgentBoardFramePad*2 + cloudAgentBoardFrameHeader
			}
			cursorY += height + 80
		}
	}

	connect := func(from, to, fromHandle string) error {
		id := cloudAgentID(userID, fmt.Sprintf("board-edge:%s:%s:%s", from, to, fromHandle))
		for _, edge := range edges {
			if stringValue(edge["id"]) == id || (stringValue(edge["fromNodeId"]) == from && stringValue(edge["toNodeId"]) == to && stringValue(edge["fromHandleId"]) == fromHandle) {
				return nil
			}
		}
		if err := validateCloudAgentConnectionWithHandles(nodes, from, to, fromHandle, "", edges); err != nil {
			return err
		}
		edge := map[string]any{"id": id, "fromNodeId": from, "toNodeId": to}
		if fromHandle != "" {
			edge["fromHandleId"] = fromHandle
		}
		edges = append(edges, edge)
		plan.Counts["edges"]++
		return applyCloudAgentStoryboardConnection(nodes, from, to, fromHandle, "")
	}
	for _, row := range rows {
		rowID := stringValue(row["id"])
		if keyframeID := keyframeOfRow[rowID]; keyframeID != "" {
			if err := connect(args.StoryboardNodeID, keyframeID, "row:"+rowID); err != nil {
				return nil, err
			}
		}
		if videoID := videoOfRow[rowID]; videoID != "" {
			if err := connect(args.StoryboardNodeID, videoID, "row:"+rowID); err != nil {
				return nil, err
			}
			if keyframeID := keyframeOfRow[rowID]; keyframeID != "" {
				if err := connect(keyframeID, videoID, ""); err != nil {
					return nil, err
				}
			}
		}
	}
	for _, asset := range args.Assets {
		if !cloudAgentContainsString(plan.Assets, asset.ID) {
			continue
		}
		for _, rowID := range asset.RowIDs {
			if keyframeID := keyframeOfRow[rowID]; keyframeID != "" {
				if err := connect(asset.ID, keyframeID, ""); err != nil {
					return nil, err
				}
			}
		}
	}
	doc["nodes"] = nodes
	doc["connections"] = edges
	for _, row := range rows {
		rowID := stringValue(row["id"])
		entry := map[string]any{"rowId": rowID}
		if id := keyframeOfRow[rowID]; id != "" {
			entry["keyframeNodeId"] = id
		}
		if id := videoOfRow[rowID]; id != "" {
			entry["videoNodeId"] = id
		}
		if len(entry) > 1 {
			plan.Rows = append(plan.Rows, entry)
		}
	}
	plan.Preview = cloudAgentBoardPreview(plan, len(rows))
	return plan, nil
}

func cloudAgentBoardSummary(plan *cloudAgentBoardPlan) string {
	parts := []string{}
	for _, entry := range []struct{ key, label string }{{"overview", "总控"}, {"assets", "资产"}, {"keyframes", "关键帧"}, {"videos", "视频"}, {"frames", "分组"}, {"edges", "连线"}} {
		if count := plan.Counts[entry.key]; count > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", entry.label, count))
		}
	}
	if len(parts) == 0 {
		return "看板已经完整，本次没有新增内容"
	}
	return "搭建看板：" + strings.Join(parts, "、")
}

func cloudAgentBoardPreview(plan *cloudAgentBoardPlan, rows int) cloudAgentApprovalPreview {
	summary := cloudAgentBoardSummary(plan)
	details := []string{fmt.Sprintf("分镜共 %d 个镜头行", rows), "只建空白占位并写入提示词，不提交收费生成"}
	if len(plan.Missing) > 0 {
		details = append(details, "缺提示词未建："+truncateRunes(strings.Join(plan.Missing, "、"), 160))
	}
	return cloudAgentApprovalPreview{
		Kind: "build_board", Title: "搭建制作看板", Description: summary + "；按分组着色排成镜头矩阵，可整体撤销。",
		Items: []cloudAgentApprovalPreviewItem{{Operation: "build_board", Summary: summary, Details: details}},
	}
}

func cloudAgentPreviewBuildBoard(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentBuildBoard(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func applyCloudAgentBuildBoard(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentBuildBoard(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	total := 0
	for _, count := range plan.Counts {
		total += count
	}
	if total == 0 {
		return map[string]any{"canvasId": canvasID, "snapshotHash": plan.BeforeHash, "summary": cloudAgentBoardSummary(plan), "rows": plan.Rows}, nil
	}
	before := plan.Canvas.PayloadJSON
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{
			UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: "canvas_build_board",
			BeforeSnapshotHash: plan.BeforeHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document),
			BeforeJSON: before, Preview: &plan.Preview,
		}); err != nil {
			return nil, err
		}
	}
	result := map[string]any{
		"canvasId": canvasID, "snapshotHash": cloudAgentCanvasHash(plan.Document), "beforeSnapshotHash": plan.BeforeHash,
		"summary": cloudAgentBoardSummary(plan), "counts": plan.Counts, "assetNodeIds": plan.Assets, "rows": plan.Rows,
		"next": "先用 canvas_preflight 体检资产与关键帧（mode=image），再用 generate_media_batch 分批生成：资产 → 关键帧 → 视频",
	}
	if len(plan.Missing) > 0 {
		result["missingPrompts"] = plan.Missing
	}
	return result, nil
}
