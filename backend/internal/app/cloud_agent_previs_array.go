package app

import (
	"fmt"
	"math"
	"math/rand"
)

// object_array_add：一次把同一个道具按 一排/方阵/环形/散布 摆 N 个（例如「三栋 12 层楼」）。
// 规则与 web/src/lib/canvas/previs/previs-array.ts 一致：间距缺省为占地+2m，错落只浮动层数/高度类参数。
const cloudAgentPrevisArrayMax = 30

var cloudAgentPrevisArrayVaryKeys = map[string]bool{"floors": true, "tiers": true, "height": true, "bays": true, "steps": true}

func cloudAgentPrevisArrayOffsets(pattern string, count, columns int, spacing float64, seed int64) [][2]float64 {
	offsets := make([][2]float64, 0, count)
	switch pattern {
	case "grid":
		if columns <= 0 {
			columns = int(math.Ceil(math.Sqrt(float64(count))))
		}
		rows := int(math.Ceil(float64(count) / float64(columns)))
		for index := 0; index < count; index++ {
			offsets = append(offsets, [2]float64{(float64(index%columns) - float64(columns-1)/2) * spacing, (float64(index/columns) - float64(rows-1)/2) * spacing})
		}
	case "ring":
		radius := 0.0
		if count > 1 {
			radius = math.Max(spacing, float64(count)*spacing/(2*math.Pi))
		}
		for index := 0; index < count; index++ {
			angle := float64(index) / float64(count) * 2 * math.Pi
			offsets = append(offsets, [2]float64{math.Sin(angle) * radius, math.Cos(angle) * radius})
		}
	case "scatter":
		random := rand.New(rand.NewSource(seed))
		half := spacing * math.Sqrt(float64(count)) * 1.3 / 2
		for attempt := 0; len(offsets) < count && attempt < count*40; attempt++ {
			candidate := [2]float64{(random.Float64()*2 - 1) * half, (random.Float64()*2 - 1) * half}
			ok := true
			for _, point := range offsets {
				if math.Hypot(point[0]-candidate[0], point[1]-candidate[1]) < spacing*0.85 {
					ok = false
					break
				}
			}
			if ok {
				offsets = append(offsets, candidate)
			}
		}
		for len(offsets) < count {
			offsets = append(offsets, [2]float64{(float64(len(offsets)) - float64(count)/2) * spacing, half + spacing})
		}
	default:
		for index := 0; index < count; index++ {
			offsets = append(offsets, [2]float64{(float64(index) - float64(count-1)/2) * spacing, 0})
		}
	}
	return offsets
}

// cloudAgentPrevisArraySpacing 缺省间距：参数化组件按宽/深/长参数，其余按目录占地。
func cloudAgentPrevisArraySpacing(propID string, params map[string]any) float64 {
	size := cloudAgentPrevisFootprints[propID]
	for _, key := range []string{"width", "depth", "length"} {
		if value, ok := params[key]; ok {
			size = math.Max(size, numberValue(value, 0))
		}
	}
	if propID == "road" || propID == "wall" || propID == "fence_line" {
		// 线性组件首尾相接更常用：沿长度方向排布时间距取长度本身。
		return math.Max(1, size)
	}
	return math.Max(1, size+2)
}

// cloudAgentPrevisApplyArrayAdd 展开为 N 个独立 prop 对象，ID 为 `${id}-1..N`。
func cloudAgentPrevisApplyArrayAdd(objects *[]map[string]any, operation cloudAgentPrevisPatchOperation, index int) (cloudAgentApprovalPreviewItem, error) {
	if operation.Kind != "" && operation.Kind != "prop" {
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest("object_array_add 只支持 kind=prop")
	}
	count := 3
	if operation.Count != nil {
		count = *operation.Count
	}
	if count < 1 || count > cloudAgentPrevisArrayMax {
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest(fmt.Sprintf("object_array_add count 范围 1-%d", cloudAgentPrevisArrayMax))
	}
	if len(*objects)+count > cloudAgentPrevisMaxObjects {
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest(fmt.Sprintf("场景对象最多 %d 个；成片建筑请改用 kind=layout", cloudAgentPrevisMaxObjects))
	}
	pattern := operation.Pattern
	if pattern == "" {
		pattern = "line"
	}
	if err := cloudAgentPrevisValidateEnum(pattern, "pattern", "line", "grid", "ring", "scatter"); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	facing := operation.Facing
	if facing == "" {
		facing = "same"
		if pattern == "ring" {
			facing = "center"
		}
	}
	if err := cloudAgentPrevisValidateEnum(facing, "facing", "same", "center", "outward"); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	vary := 0.0
	if operation.Vary != nil {
		vary = *operation.Vary
	}
	if err := cloudAgentPrevisFiniteInRange(vary, "vary", 0, 1); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	params, err := cloudAgentPrevisNormalizeParams(operation.PropID, nil, operation.Params)
	if err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	spacing := cloudAgentPrevisArraySpacing(operation.PropID, params)
	if operation.Spacing != nil {
		spacing = *operation.Spacing
	}
	if err := cloudAgentPrevisFiniteInRange(spacing, "spacing", 0.2, 500); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	columns := 0
	if operation.Columns != nil {
		columns = *operation.Columns
	}
	center := []float64{0, 0, 0}
	if operation.Position != nil {
		center = *operation.Position
	}
	baseYaw := 0.0
	if operation.Rotation != nil {
		if err := cloudAgentPrevisValidateVec3(*operation.Rotation, "rotation"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		baseYaw = (*operation.Rotation)[1]
	}
	seed := int64(1)
	if operation.Seed != nil {
		seed = int64(*operation.Seed)
	}
	random := rand.New(rand.NewSource(seed ^ 0x5bd1e995))
	baseName := ""
	if operation.Name != nil {
		baseName = *operation.Name
	}
	if baseName == "" {
		if prop, ok := cloudAgentPrevisFindProp(operation.PropID); ok {
			baseName = prop.Name
		}
	}
	existing := map[string]bool{}
	for _, object := range *objects {
		existing[stringValue(object["id"])] = true
	}
	offsets := cloudAgentPrevisArrayOffsets(pattern, count, columns, spacing, seed)
	items := *objects
	for itemIndex, offset := range offsets {
		id := operation.ID
		name := baseName
		if count > 1 {
			id = fmt.Sprintf("%s-%d", operation.ID, itemIndex+1)
			name = fmt.Sprintf("%s %d", baseName, itemIndex+1)
		}
		if existing[id] {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("批量对象 ID 已存在：" + id)
		}
		if err := validateCloudAgentID(id, fmt.Sprintf("operations[%d].id", index), 80); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		yaw := baseYaw
		if facing == "center" && (offset[0] != 0 || offset[1] != 0) {
			yaw = math.Atan2(-offset[0], -offset[1])
		} else if facing == "outward" && (offset[0] != 0 || offset[1] != 0) {
			yaw = math.Atan2(offset[0], offset[1])
		}
		single := operation
		single.ID = id
		single.Kind = "prop"
		single.Params = cloudAgentPrevisVaryParams(operation.PropID, params, vary, random)
		if vary > 0 && params == nil {
			variant := random.Intn(8)
			single.Variant = &variant
		}
		position := []float64{center[0] + offset[0], 0, center[2] + offset[1]}
		item, _, err := cloudAgentPrevisAddCatalogObject(single, name, position, []float64{0, yaw, 0}, []float64{1, 1, 1})
		if err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		items = append(items, item)
		existing[id] = true
	}
	*objects = items
	return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: truncateRunes(baseName, cloudAgentPrevisTextLimit), Summary: fmt.Sprintf("批量新增 %d 个《%s》（%s）", count, baseName, pattern)}, nil
}

func cloudAgentPrevisVaryParams(propID string, params map[string]any, vary float64, random *rand.Rand) map[string]any {
	if params == nil {
		return nil
	}
	next := make(map[string]any, len(params))
	for key, value := range params {
		next[key] = value
	}
	if vary <= 0 {
		return next
	}
	for _, spec := range cloudAgentPrevisPropParams[propID] {
		if len(spec.Options) > 0 || !cloudAgentPrevisArrayVaryKeys[spec.Key] {
			continue
		}
		value := numberValue(next[spec.Key], spec.Default) * (1 + (random.Float64()*2-1)*0.45*vary)
		value = math.Min(spec.Max, math.Max(spec.Min, value))
		if spec.Integer {
			value = math.Round(value)
		}
		next[spec.Key] = value
	}
	return next
}
