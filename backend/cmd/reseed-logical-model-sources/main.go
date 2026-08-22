package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"gorm.io/gorm"
)

// 此命令把“单条系统渠道线路驱动、但尚未绑定来源”的前台模型规范为系统渠道投影。
// 保留产品名称、排序、说明和旧 ID 映射；能力、默认参数、路由和价格统一从系统模型生成。
type sourcePlan struct {
	logicalModel model.LogicalModel
	source       model.ChannelModel
}

func main() {
	apply := flag.Bool("apply", false, "将符合条件的前台模型改为系统渠道模型驱动")
	flag.Parse()

	db, err := database.Open(database.Config{Driver: "postgres", DSN: os.Getenv("DATABASE_URL"), DataDir: os.Getenv("CANVAS_BACKEND_DATA_DIR")})
	if err != nil {
		log.Fatal(err)
	}
	if db.Dialector.Name() != "postgres" {
		log.Fatal("前台模型目录刷新只允许连接 PostgreSQL")
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		log.Fatal(err)
	}

	repo := repository.New(db)
	plans, err := buildPlans(repo)
	if err != nil {
		log.Fatal(err)
	}
	for _, plan := range plans {
		log.Printf("%s: 当前前台模型=%s，系统模型=%s，协议=%s", plan.logicalModel.Code, plan.logicalModel.ID, plan.source.ModelKey, plan.source.Protocol)
	}
	if !*apply {
		log.Print("dry-run 完成；确认后使用 --apply 写入。未匹配单条系统线路的前台模型不会被修改")
		return
	}
	if err := ensureNoActiveTasks(db, plans); err != nil {
		log.Fatal(err)
	}
	actor, err := migrationAdmin(db)
	if err != nil {
		log.Fatal(err)
	}
	svc := service.New(repo, os.Getenv("CANVAS_BACKEND_DATA_DIR"))
	for _, plan := range plans {
		if _, err := svc.SaveAdminLogicalModel(actor, plan.logicalModel.ID, service.LogicalModelRequest{
			Code:                 plan.logicalModel.Code,
			Name:                 plan.logicalModel.Name,
			Icon:                 plan.logicalModel.Icon,
			Description:          plan.logicalModel.Description,
			Capability:           plan.source.Capability,
			Enabled:              plan.logicalModel.Enabled,
			SortOrder:            plan.logicalModel.SortOrder,
			LegacyModelIDs:       decodeLegacyModelIDs(plan.logicalModel.LegacyModelIDsJSON),
			SourceChannelModelID: plan.source.ID,
		}); err != nil {
			log.Fatalf("刷新前台模型 %s 失败：%v", plan.logicalModel.Code, err)
		}
		log.Printf("已刷新前台模型：%s", plan.logicalModel.Code)
	}
	log.Print("前台模型目录刷新完成：能力、默认参数、路线和价格均以系统渠道模型为准")
}

func buildPlans(repo *repository.Repository) ([]sourcePlan, error) {
	items, err := repo.LogicalModels(false)
	if err != nil {
		return nil, err
	}
	plans := make([]sourcePlan, 0)
	for _, item := range items {
		if strings.TrimSpace(item.SourceChannelModelID) != "" {
			continue
		}
		graph, graphErr := repo.LogicalModelGraph(item.ID, false)
		if graphErr != nil {
			return nil, fmt.Errorf("读取前台模型 %s 的当前线路：%w", item.Code, graphErr)
		}
		if graph.Revision == nil || len(graph.Routes) != 1 || len(graph.ChannelModels) != 1 {
			return nil, fmt.Errorf("前台模型 %s 不是单条有效系统线路，拒绝自动改写", item.Code)
		}
		route := graph.Routes[0]
		source := graph.ChannelModels[0]
		if route.ChannelModelID != source.ID {
			return nil, fmt.Errorf("前台模型 %s 的当前线路与系统模型不一致", item.Code)
		}
		channel, channelErr := repo.AdminSystemChannel(source.ChannelID)
		if channelErr != nil {
			return nil, fmt.Errorf("前台模型 %s 的线路不是系统渠道：%w", item.Code, channelErr)
		}
		if !channel.Enabled || !source.Enabled || !source.PriceConfigured {
			return nil, fmt.Errorf("前台模型 %s 的系统模型未启用或未配置价格", item.Code)
		}
		plans = append(plans, sourcePlan{logicalModel: item, source: source})
	}
	sort.Slice(plans, func(i, j int) bool {
		return plans[i].logicalModel.Code < plans[j].logicalModel.Code
	})
	return plans, nil
}

func ensureNoActiveTasks(db *gorm.DB, plans []sourcePlan) error {
	ids := make([]string, 0, len(plans))
	for _, plan := range plans {
		ids = append(ids, plan.logicalModel.ID)
	}
	if len(ids) == 0 {
		return nil
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
	return fmt.Errorf("存在 queued 或 running 前台模型任务，拒绝刷新：%s", strings.Join(parts, ", "))
}

func migrationAdmin(db *gorm.DB) (*model.User, error) {
	var actor model.User
	if err := db.Where("role = ?", model.UserRoleAdmin).Order("created_at asc").First(&actor).Error; err != nil {
		return nil, fmt.Errorf("需要现有管理员作为迁移审计主体：%w", err)
	}
	return &actor, nil
}

func decodeLegacyModelIDs(raw string) []string {
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return []string{}
	}
	return ids
}
