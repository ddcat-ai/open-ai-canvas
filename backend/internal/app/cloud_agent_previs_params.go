package app

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// 参数化基础组件的参数白名单，与 web/src/lib/canvas/previs/previs-prop-catalog.ts 的 params 一一对应。
type cloudAgentPrevisParamSpec struct {
	Key      string
	Min, Max float64
	Default  float64
	Integer  bool
	Options  []string // 非空表示枚举参数，第一个为默认值
}

func previsNum(key string, min, max, def float64, integer bool) cloudAgentPrevisParamSpec {
	return cloudAgentPrevisParamSpec{Key: key, Min: min, Max: max, Default: def, Integer: integer}
}

func previsEnum(key string, options ...string) cloudAgentPrevisParamSpec {
	return cloudAgentPrevisParamSpec{Key: key, Options: options}
}

var previsMaterials = []string{"plaster", "brick", "stone", "concrete", "wood"}

var cloudAgentPrevisPropParams = map[string][]cloudAgentPrevisParamSpec{
	"building": {previsNum("floors", 1, 80, 6, true), previsNum("width", 4, 80, 14, false), previsNum("depth", 4, 60, 12, false), previsNum("floorHeight", 2.6, 6, 3.2, false),
		previsEnum("style", "modern", "glass", "brick", "concrete", "ancient"), previsEnum("roof", "flat", "gable", "chinese"), previsEnum("balcony", "none", "front")},
	"tower":        {previsNum("floors", 10, 150, 40, true), previsNum("width", 12, 70, 28, false), previsNum("setbacks", 0, 3, 2, true), previsEnum("crown", "spire", "flat", "crown")},
	"chinese_hall": {previsNum("bays", 3, 11, 5, true), previsNum("depth", 5, 20, 9, false), previsNum("tiers", 1, 5, 1, true)},
	"road":         {previsNum("length", 2, 600, 40, false), previsNum("width", 2, 60, 10, false), previsNum("lanes", 0, 8, 2, true), previsNum("sidewalk", 0, 10, 2.5, false), previsEnum("surface", "asphalt", "stone", "dirt")},
	"wall":         {previsNum("length", 0.5, 200, 8, false), previsNum("height", 0.3, 20, 3, false), previsNum("thickness", 0.08, 8, 0.3, false), previsEnum("material", previsMaterials...), previsEnum("top", "none", "tiles", "battlement")},
	"ground_patch": {previsNum("width", 0.5, 800, 20, false), previsNum("depth", 0.5, 800, 20, false), previsEnum("surface", "grass", "plaza", "stone", "sand", "water", "soil", "snow")},
	"stairs":       {previsNum("width", 0.6, 40, 3, false), previsNum("steps", 1, 60, 8, true), previsNum("stepHeight", 0.08, 0.5, 0.17, false), previsNum("stepDepth", 0.15, 1, 0.3, false), previsEnum("material", "stone", "concrete", "wood")},
	"fence_line":   {previsNum("length", 1, 200, 8, false), previsNum("height", 0.4, 4, 1.1, false), previsEnum("style", "wood", "metal", "stone")},
	"room":         {previsNum("width", 2, 40, 6, false), previsNum("depth", 2, 40, 5, false), previsNum("height", 2.2, 8, 3, false), previsNum("windows", 0, 6, 2, true), previsEnum("door", "right", "none", "left", "back"), previsEnum("front", "open", "closed")},
	"platform":     {previsNum("width", 0.5, 200, 8, false), previsNum("depth", 0.5, 200, 8, false), previsNum("height", 0.05, 10, 0.6, false), previsEnum("material", "stone", "concrete", "wood", "plaster")},
	"column":       {previsNum("height", 0.5, 30, 3, false), previsNum("radius", 0.05, 3, 0.25, false), previsEnum("style", "round", "square", "chinese")},
}

// 目录道具默认占地（宽深取大值，米），用于批量排布的默认间距；数据由前端目录生成。
var cloudAgentPrevisFootprints = map[string]float64{
	"building": 14, "tower": 28, "chinese_hall": 17, "road": 40, "wall": 8, "ground_patch": 20, "stairs": 3, "fence_line": 8, "room": 6, "platform": 8, "column": 0.7,
	"tree_broadleaf": 5, "tree_pine": 3.6, "tree_willow": 5.5, "tree_cherry": 4.6, "tree_palm": 4, "bamboo": 2.4, "bush": 1.6, "hedge": 4, "grass": 0.9, "flowers": 1.2, "flower_bed": 3, "potted_plant": 0.6, "lotus_pond": 6,
	"ancient_house": 9, "ancient_shop": 8, "ancient_courtyard": 22, "tower_hall": 16, "pagoda": 9, "pavilion": 5, "city_gate": 32, "ancient_wall": 20, "paifang": 12, "stone_bridge": 14, "well": 2.4, "market_stall": 3, "lantern_pole": 0.8,
	"modern_house": 11, "villa": 10, "apartment": 18, "office_tower": 26, "skyscraper": 32, "shop_front": 10,
	"street_lamp": 1.6, "traffic_light": 3.4, "bench": 1.8, "bus_stop": 5, "fence": 4, "trash_bin": 0.6,
	"car": 4.6, "bus": 11, "ox_cart": 5.4, "bicycle": 1.8, "rock": 1.4, "boulder": 4, "hill": 40, "log": 4,
	"sofa": 2.2, "dining_table": 1.6, "chair": 0.52, "bed": 2.15, "bookshelf": 1.2, "desk": 1.4,
}

// cloudAgentPrevisNormalizeParams 校验并补全参数：未知键、越界数值、非法枚举一律拒绝，缺省键填默认值。
// base 为已有参数（object_update 时合并），patch 为 Agent 本次提交的参数。
func cloudAgentPrevisNormalizeParams(propID string, base map[string]any, patch map[string]any) (map[string]any, error) {
	specs, ok := cloudAgentPrevisPropParams[propID]
	if !ok {
		if len(patch) > 0 {
			return nil, BadAuthRequest(fmt.Sprintf("道具 %s 没有可调参数", propID))
		}
		return nil, nil
	}
	byKey := make(map[string]cloudAgentPrevisParamSpec, len(specs))
	for _, spec := range specs {
		byKey[spec.Key] = spec
	}
	for key := range patch {
		if _, ok := byKey[key]; !ok {
			return nil, BadAuthRequest(fmt.Sprintf("道具 %s 不支持参数 %s，可用：%s", propID, key, cloudAgentPrevisParamKeys(propID)))
		}
	}
	result := make(map[string]any, len(specs))
	for _, spec := range specs {
		value, provided := patch[spec.Key]
		if !provided {
			value, provided = base[spec.Key]
		}
		if len(spec.Options) > 0 {
			text, _ := value.(string)
			if !provided {
				text = spec.Options[0]
			}
			if err := cloudAgentPrevisValidateEnum(text, "参数 "+spec.Key, spec.Options...); err != nil {
				return nil, err
			}
			result[spec.Key] = text
			continue
		}
		number := spec.Default
		if provided {
			number = numberValue(value, math.NaN())
		}
		if err := cloudAgentPrevisFiniteInRange(number, "参数 "+spec.Key, spec.Min, spec.Max); err != nil {
			return nil, err
		}
		if spec.Integer {
			number = math.Round(number)
		}
		result[spec.Key] = number
	}
	return result, nil
}

func cloudAgentPrevisParamKeys(propID string) string {
	keys := make([]string, 0)
	for _, spec := range cloudAgentPrevisPropParams[propID] {
		if len(spec.Options) > 0 {
			keys = append(keys, spec.Key+"("+strings.Join(spec.Options, "/")+")")
		} else {
			keys = append(keys, fmt.Sprintf("%s(%g-%g)", spec.Key, spec.Min, spec.Max))
		}
	}
	return strings.Join(keys, ",")
}

// cloudAgentPrevisParamsGuide 列出所有参数化组件的参数，放进 previs_scene_read.catalog。
func cloudAgentPrevisParamsGuide() map[string]string {
	ids := make([]string, 0, len(cloudAgentPrevisPropParams))
	for id := range cloudAgentPrevisPropParams {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	guide := make(map[string]string, len(ids))
	for _, id := range ids {
		guide[id] = cloudAgentPrevisParamKeys(id)
	}
	return guide
}
