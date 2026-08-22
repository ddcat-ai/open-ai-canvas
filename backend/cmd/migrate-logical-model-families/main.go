package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"gorm.io/gorm"
)

// 迁移只重建创作端目录。旧模型、revision、route 以及全部任务和账务快照都保留，
// 这样历史任务恢复或重试时仍会使用它创建时绑定的供应线路。
type familyDefinition struct {
	Code        string
	Name        string
	Description string
	OldCodes    []string
}

type familyRoute struct {
	channelModel model.ChannelModel
	spec         service.CapabilitySpec
}

type familyPlan struct {
	definition familyDefinition
	oldModels  []model.LogicalModel
	routes     []familyRoute
	request    service.LogicalModelRequest
	exists     bool
}

var familyDefinitions = []familyDefinition{
	{Code: "seedance-2-5", Name: "Seedance 2.5", Description: "Seedance 2.5 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"doubao-seedance-2-5-480p", "doubao-seedance-2-5", "doubao-seedance-2-5-1080p"}},
	{Code: "seedance-2-0", Name: "Seedance 2.0", Description: "Seedance 2.0 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"doubao-seedance-2-0-480p", "doubao-seedance-2-0", "doubao-seedance-2-0-1080p"}},
	{Code: "seedance-2-0-mini", Name: "Seedance 2.0 Mini", Description: "Seedance 2.0 Mini 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"doubao-seedance-2-0-mini-480p", "doubao-seedance-2-0-mini"}},
	{Code: "seedance-2-0-fast", Name: "Seedance 2.0 Fast", Description: "Seedance 2.0 Fast 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"doubao-seedance-2-0-fast-480p", "doubao-seedance-2-0-fast"}},
	{Code: "grok-video-1-5", Name: "Grok Imagine Video 1.5", Description: "Grok Imagine Video 1.5，按所选分辨率自动路由并结算", OldCodes: []string{"grok-video-1.5-480p", "grok-video-1.5-720p", "grok-imagine-video-1.5-1080p"}},
	{Code: "artdance-2-0", Name: "Artdance 2.0", Description: "Artdance 2.0 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"artdance-2-0-480p", "artdance-2-0-720p", "artdance-2-0-1080p"}},
	{Code: "artdance-2-5", Name: "Artdance 2.5", Description: "Artdance 2.5 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"artdance-2-5-480p", "artdance-2-5-720p"}},
	{Code: "artdance-2-mini", Name: "Artdance 2 Mini", Description: "Artdance 2 Mini 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"artdance-2-mini-480p", "artdance-2-mini-720p"}},
	{Code: "artdance-fast", Name: "Artdance Fast", Description: "Artdance Fast 视频生成，按所选分辨率自动路由并结算", OldCodes: []string{"artdance-fast-480p", "artdance-fast-720p"}},
}

func main() {
	apply := flag.Bool("apply", false, "写入模型家族并归档旧 SKU 目录项")
	flag.Parse()

	db, err := database.Open(database.Config{
		Driver:  "postgres",
		DSN:     os.Getenv("DATABASE_URL"),
		DataDir: os.Getenv("CANVAS_BACKEND_DATA_DIR"),
	})
	if err != nil {
		log.Fatal(err)
	}
	if db.Dialector.Name() != "postgres" {
		log.Fatal("模型家族迁移只允许连接 PostgreSQL")
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		log.Fatal(err)
	}

	repo := repository.New(db)
	plans, err := buildPlans(repo, db)
	if err != nil {
		log.Fatal(err)
	}
	printPlans(plans)
	if err := ensureNoActiveTasks(db, plans); err != nil {
		log.Fatal(err)
	}
	if !*apply {
		log.Print("dry-run 完成；确认无误后传入 --apply 执行写入")
		return
	}

	actor, err := migrationAdmin(db)
	if err != nil {
		log.Fatal(err)
	}
	svc := service.New(repo, os.Getenv("CANVAS_BACKEND_DATA_DIR"))
	for _, plan := range plans {
		if plan.exists {
			log.Printf("模型家族已存在，跳过创建：%s", plan.definition.Code)
			continue
		}
		if _, err := svc.SaveAdminLogicalModel(actor, "", plan.request); err != nil {
			log.Fatalf("创建模型家族 %s 失败：%v", plan.definition.Code, err)
		}
		log.Printf("已创建模型家族：%s", plan.definition.Code)
	}
	if err := verifyPlans(db, svc, plans); err != nil {
		log.Fatal(err)
	}
	for _, plan := range plans {
		for _, old := range plan.oldModels {
			if old.ArchivedAt != nil {
				continue
			}
			if err := svc.DeleteAdminLogicalModel(actor, old.ID); err != nil {
				log.Fatalf("归档旧模型 %s 失败：%v", old.Code, err)
			}
			log.Printf("已归档旧 SKU 目录项：%s", old.Code)
		}
	}
	log.Print("模型家族迁移完成；历史任务、账务和路由快照均未改写")
}

func buildPlans(repo *repository.Repository, db *gorm.DB) ([]familyPlan, error) {
	var models []model.LogicalModel
	if err := db.Order("sort_order asc, created_at asc").Find(&models).Error; err != nil {
		return nil, err
	}
	graphs, err := repo.LogicalModelGraphs(models, true)
	if err != nil {
		return nil, err
	}
	modelByCode := make(map[string]model.LogicalModel, len(models))
	for _, item := range models {
		modelByCode[item.Code] = item
	}
	plans := make([]familyPlan, 0, len(familyDefinitions))
	for _, definition := range familyDefinitions {
		plan, planErr := buildFamilyPlan(definition, modelByCode, graphs)
		if planErr != nil {
			return nil, planErr
		}
		var existing model.LogicalModel
		err := db.Where("code = ? AND archived_at IS NULL", definition.Code).First(&existing).Error
		if err == nil {
			plan.exists = true
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		plans = append(plans, plan)
	}
	return plans, nil
}

func buildFamilyPlan(definition familyDefinition, modelByCode map[string]model.LogicalModel, graphs map[string]*repository.LogicalModelGraph) (familyPlan, error) {
	plan := familyPlan{definition: definition}
	routeSpecs := make([]service.CapabilitySpec, 0, len(definition.OldCodes))
	defaults := make([]map[string]any, 0, len(definition.OldCodes))
	legacyIDs := make([]string, 0, len(definition.OldCodes))
	sortOrder := math.MaxInt
	icon := ""
	for _, code := range definition.OldCodes {
		item, found := modelByCode[code]
		if !found {
			return plan, fmt.Errorf("模型家族 %s 缺少旧 SKU 模型：%s", definition.Code, code)
		}
		graph := graphs[item.ID]
		if graph == nil || graph.Revision == nil {
			return plan, fmt.Errorf("旧 SKU 模型 %s 缺少当前 revision", code)
		}
		route, channelModel, err := onlyEnabledRoute(graph)
		if err != nil {
			return plan, fmt.Errorf("旧 SKU 模型 %s：%w", code, err)
		}
		if route.ChannelModelID != channelModel.ID {
			return plan, fmt.Errorf("旧 SKU 模型 %s 的供应线路快照不一致", code)
		}
		capabilityConfig, err := service.DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
		if err != nil {
			return plan, fmt.Errorf("读取渠道模型 %s 能力失败：%w", channelModel.ModelKey, err)
		}
		spec, err := service.CapabilitySpecFromModelCapabilityConfig(capabilityConfig, channelModel.Capability)
		if err != nil {
			return plan, err
		}
		if spec.Capability != "video" || channelModel.Capability != "video" {
			return plan, fmt.Errorf("旧 SKU 模型 %s 不是视频模型", code)
		}
		oldDefaults := map[string]any{}
		if err := json.Unmarshal([]byte(graph.Revision.DefaultOptionsJSON), &oldDefaults); err != nil {
			return plan, fmt.Errorf("读取旧 SKU 模型 %s 默认参数失败：%w", code, err)
		}
		plan.oldModels = append(plan.oldModels, item)
		plan.routes = append(plan.routes, familyRoute{channelModel: channelModel, spec: spec})
		routeSpecs = append(routeSpecs, spec)
		defaults = append(defaults, oldDefaults)
		legacyIDs = append(legacyIDs, item.ID)
		if item.SortOrder < sortOrder {
			sortOrder = item.SortOrder
		}
		if icon == "" {
			icon = item.Icon
		}
	}
	productSpec, err := unionCapabilitySpecs(routeSpecs)
	if err != nil {
		return plan, fmt.Errorf("合并模型家族 %s 能力失败：%w", definition.Code, err)
	}
	if sortOrder == math.MaxInt {
		sortOrder = 0
	}
	plan.request = service.LogicalModelRequest{
		Code:           definition.Code,
		Name:           definition.Name,
		Icon:           icon,
		Description:    definition.Description,
		Capability:     "video",
		Enabled:        true,
		SortOrder:      sortOrder,
		PricePolicy:    "channel",
		BillingMode:    "fixed_request",
		LegacyModelIDs: legacyIDs,
		CapabilitySpec: productSpec,
		DefaultOptions: familyDefaultOptions(productSpec, defaults),
		Routes:         make([]service.LogicalRouteRequest, 0, len(plan.routes)),
	}
	for _, route := range plan.routes {
		plan.request.Routes = append(plan.request.Routes, service.LogicalRouteRequest{ChannelModelID: route.channelModel.ID, Enabled: true, Weight: 1})
	}
	return plan, nil
}

func onlyEnabledRoute(graph *repository.LogicalModelGraph) (model.LogicalModelRoute, model.ChannelModel, error) {
	routes := make([]model.LogicalModelRoute, 0, len(graph.Routes))
	for _, route := range graph.Routes {
		if route.Enabled && route.Weight > 0 {
			routes = append(routes, route)
		}
	}
	if len(routes) != 1 {
		return model.LogicalModelRoute{}, model.ChannelModel{}, fmt.Errorf("需要恰好一条启用供应线路，当前为 %d 条", len(routes))
	}
	for _, channelModel := range graph.ChannelModels {
		if channelModel.ID == routes[0].ChannelModelID {
			return routes[0], channelModel, nil
		}
	}
	return model.LogicalModelRoute{}, model.ChannelModel{}, errors.New("启用供应线路引用的渠道模型不存在")
}

func unionCapabilitySpecs(specs []service.CapabilitySpec) (service.CapabilitySpec, error) {
	if len(specs) == 0 {
		return service.CapabilitySpec{}, errors.New("没有可合并的供应线路能力")
	}
	result := service.CapabilitySpec{Version: 1, Capability: specs[0].Capability, Inputs: map[string]service.InputConstraint{}, Options: map[string]service.OptionConstraint{}}
	operations := make(map[string]bool)
	for _, spec := range specs {
		if spec.Version != 1 || spec.Capability != result.Capability {
			return result, errors.New("供应线路能力类型不一致")
		}
		for _, operation := range spec.Operations {
			operations[operation] = true
		}
		for name, constraint := range spec.Inputs {
			current, exists := result.Inputs[name]
			if !exists {
				result.Inputs[name] = constraint
				continue
			}
			result.Inputs[name] = service.InputConstraint{Min: min(current.Min, constraint.Min), Max: max(current.Max, constraint.Max)}
		}
		for name, constraint := range spec.Options {
			values, valuesErr := optionValues(constraint)
			if valuesErr != nil {
				return result, fmt.Errorf("参数 %s：%w", name, valuesErr)
			}
			current := result.Options[name]
			current.Values = appendUniqueValues(current.Values, values...)
			current.Min, current.Max, current.Step = nil, nil, nil
			result.Options[name] = current
		}
	}
	for operation := range operations {
		result.Operations = append(result.Operations, operation)
	}
	sort.Strings(result.Operations)
	for name, constraint := range result.Options {
		sort.SliceStable(constraint.Values, func(i, j int) bool {
			return optionValueSortKey(constraint.Values[i]) < optionValueSortKey(constraint.Values[j])
		})
		result.Options[name] = constraint
	}
	return service.NormalizeCapabilitySpec(result)
}

func optionValues(constraint service.OptionConstraint) ([]any, error) {
	if len(constraint.Values) > 0 {
		return append([]any(nil), constraint.Values...), nil
	}
	if constraint.Min == nil || constraint.Max == nil || constraint.Step == nil || *constraint.Step <= 0 {
		return nil, errors.New("无法展开数值范围")
	}
	count := int(math.Floor((*constraint.Max-*constraint.Min)/(*constraint.Step)+1e-9)) + 1
	if count < 1 || count > 1000 {
		return nil, errors.New("数值范围过大，拒绝自动合并")
	}
	values := make([]any, 0, count)
	for index := 0; index < count; index++ {
		values = append(values, *constraint.Min+float64(index)*(*constraint.Step))
	}
	return values, nil
}

func appendUniqueValues(values []any, additions ...any) []any {
	seen := make(map[string]bool, len(values)+len(additions))
	for _, value := range values {
		seen[optionValueSortKey(value)] = true
	}
	for _, value := range additions {
		key := optionValueSortKey(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		values = append(values, value)
	}
	return values
}

func optionValueSortKey(value any) string {
	return fmt.Sprintf("%T:%v", value, value)
}

func familyDefaultOptions(spec service.CapabilitySpec, previous []map[string]any) map[string]any {
	defaults := make(map[string]any, len(spec.Options))
	for name, constraint := range spec.Options {
		if name == "vquality" {
			if value, found := optionValueByText(constraint.Values, "720p"); found {
				defaults[name] = value
				continue
			}
		}
		for _, candidate := range previous {
			if value, found := candidate[name]; found && optionContains(constraint, value) {
				defaults[name] = value
				break
			}
		}
		if _, found := defaults[name]; found {
			continue
		}
		if len(constraint.Values) > 0 {
			defaults[name] = constraint.Values[0]
		}
	}
	return defaults
}

func optionContains(constraint service.OptionConstraint, value any) bool {
	for _, candidate := range constraint.Values {
		if strings.EqualFold(fmt.Sprint(candidate), fmt.Sprint(value)) {
			return true
		}
		candidateNumber, candidateErr := strconv.ParseFloat(fmt.Sprint(candidate), 64)
		valueNumber, valueErr := strconv.ParseFloat(fmt.Sprint(value), 64)
		if candidateErr == nil && valueErr == nil && math.Abs(candidateNumber-valueNumber) < 1e-9 {
			return true
		}
	}
	return false
}

func optionValueByText(values []any, target string) (any, bool) {
	for _, value := range values {
		if strings.EqualFold(fmt.Sprint(value), target) {
			return value, true
		}
	}
	return nil, false
}

func ensureNoActiveTasks(db *gorm.DB, plans []familyPlan) error {
	ids := make([]string, 0)
	for _, plan := range plans {
		for _, old := range plan.oldModels {
			ids = append(ids, old.ID)
		}
	}
	var active []struct {
		LogicalModelID string
		Status         string
		Count          int64
	}
	if err := db.Model(&model.Task{}).
		Select("logical_model_id, status, count(*) AS count").
		Where("logical_model_id IN ? AND status IN ?", ids, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
		Group("logical_model_id, status").
		Scan(&active).Error; err != nil {
		return err
	}
	if len(active) == 0 {
		return nil
	}
	parts := make([]string, 0, len(active))
	for _, item := range active {
		parts = append(parts, fmt.Sprintf("%s/%s=%d", item.LogicalModelID, item.Status, item.Count))
	}
	return fmt.Errorf("存在 queued 或 running 旧 SKU 任务，拒绝归档：%s", strings.Join(parts, ", "))
}

func migrationAdmin(db *gorm.DB) (*model.User, error) {
	var actor model.User
	if err := db.Where("role = ?", model.UserRoleAdmin).Order("created_at asc").First(&actor).Error; err != nil {
		return nil, fmt.Errorf("需要现有管理员作为迁移审计主体：%w", err)
	}
	return &actor, nil
}

func verifyPlans(db *gorm.DB, svc *service.Service, plans []familyPlan) error {
	for _, plan := range plans {
		var family model.LogicalModel
		if err := db.Where("code = ? AND archived_at IS NULL", plan.definition.Code).First(&family).Error; err != nil {
			return fmt.Errorf("读取模型家族 %s 失败：%w", plan.definition.Code, err)
		}
		for _, route := range plan.routes {
			intent := routeIntent(route.spec)
			resolved, err := svc.ResolveLogicalModel(family.ID, intent)
			if err != nil {
				return fmt.Errorf("验证模型家族 %s 的渠道 SKU %s 失败：%w", plan.definition.Code, route.channelModel.ModelKey, err)
			}
			if resolved.ChannelModel.ID != route.channelModel.ID {
				return fmt.Errorf("模型家族 %s 的参数没有命中预期 SKU：期望 %s，实际 %s", plan.definition.Code, route.channelModel.ModelKey, resolved.ChannelModel.ModelKey)
			}
		}
	}
	return nil
}

func routeIntent(spec service.CapabilitySpec) service.ModelRequestIntent {
	intent := service.ModelRequestIntent{Capability: spec.Capability, Inputs: map[string]int{}, Options: map[string]any{}}
	if len(spec.Operations) > 0 {
		intent.Operation = spec.Operations[0]
	}
	for name, constraint := range spec.Inputs {
		intent.Inputs[name] = constraint.Min
	}
	for name, constraint := range spec.Options {
		if len(constraint.Values) > 0 {
			intent.Options[name] = constraint.Values[0]
		}
	}
	return intent
}

func printPlans(plans []familyPlan) {
	for _, plan := range plans {
		oldCodes := make([]string, 0, len(plan.oldModels))
		channelModels := make([]string, 0, len(plan.routes))
		for _, old := range plan.oldModels {
			oldCodes = append(oldCodes, old.Code)
		}
		for _, route := range plan.routes {
			channelModels = append(channelModels, route.channelModel.ModelKey)
		}
		log.Printf("家族 %s (%s): 旧 SKU=[%s] 路由=[%s] 默认=%v 已存在=%t", plan.definition.Code, plan.definition.Name, strings.Join(oldCodes, ", "), strings.Join(channelModels, ", "), plan.request.DefaultOptions, plan.exists)
	}
}
