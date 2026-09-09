package database

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 回归测试：守住「上游新增模型字段必须配套存量库迁移」这类问题。
//
// 上游 v1.2.8.rc1 把 channel_presentation 注册为 9 号迁移，而影策 fork 的 9 已被
// logical_model_active_code 占用，故顺延为 11。若只保留 migrateChannelPresentation
// 函数体而不把它注册进 schemaMigrations，存量库永远不会补齐 public_alias / sort_order：
// schema.go 的 AutoMigrate(Models()...) 位于 migrateSchemaV1 函数体内，
// 而存量库 1 号迁移已登记，MigrateSchema 会直接 continue 跳过 V1。
// 结果是 SystemChannels、AdminSystemChannels、ChannelModels、refreshChannelModelNames
// 以及 D-057B 的 Agent 分镜生成（agent_shot_generation 调用 SystemChannels）全部报错。
func TestMigrateSchemaBackfillsChannelPresentationOnExistingV10Database(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:channel-presentation-existing-v10?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}

	// 1. 按当前模型建全表，再删掉本次同步新增的三列，还原「同步前的生产库」。
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`ALTER TABLE model_channels DROP COLUMN public_alias`,
		`ALTER TABLE model_channels DROP COLUMN sort_order`,
		`ALTER TABLE channel_models DROP COLUMN sort_order`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatalf("构造存量库失败：%v", err)
		}
	}

	// 2. 只登记 1..10，模拟升级前的生产库状态（11 号尚未执行）。
	for _, item := range schemaMigrations {
		if item.version > 10 {
			continue
		}
		record := schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
	}

	// 3. 跑真实启动链路上的迁移。
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("MigrateSchema 失败：%v", err)
	}

	// 4. 断言新增列已补齐。
	if !db.Migrator().HasColumn(&model.ModelChannel{}, "PublicAlias") {
		t.Errorf("缺口：MigrateSchema 后 model_channels 仍缺少 public_alias 列")
	}
	if !db.Migrator().HasColumn(&model.ModelChannel{}, "SortOrder") {
		t.Errorf("缺口：MigrateSchema 后 model_channels 仍缺少 sort_order 列")
	}
	if !db.Migrator().HasColumn(&model.ChannelModel{}, "SortOrder") {
		t.Errorf("缺口：MigrateSchema 后 channel_models 仍缺少 sort_order 列")
	}

	// 5. 连带路径一：AdminSystemChannels 的 public_alias 模糊搜索。
	var channels []model.ModelChannel
	err = db.Model(&model.ModelChannel{}).Where("scope = ?", model.ChannelScopeSystem).
		Where("lower(name) LIKE ? OR lower(public_alias) LIKE ?", "x", "x").Find(&channels).Error
	if err != nil {
		t.Errorf("连带故障：AdminSystemChannels 风格查询失败：%v", err)
	}

	// 6. 连带路径二：渠道模型按 sort_order 排序（SaveChannelOrder / ChannelModels）。
	var ids []string
	if err := db.Model(&model.ChannelModel{}).Order("sort_order asc, created_at asc, id asc").Pluck("id", &ids).Error; err != nil {
		t.Errorf("连带故障：sort_order 排序查询失败：%v", err)
	}

	// 7. 11 号迁移应当已登记，且名称正确。
	var applied schemaMigration
	if err := db.First(&applied, "version = ?", 11).Error; err != nil {
		t.Errorf("11 号迁移未登记：%v", err)
	} else if applied.Name != "channel_presentation" {
		t.Errorf("11 号迁移名称 = %s，want channel_presentation", applied.Name)
	}
}
