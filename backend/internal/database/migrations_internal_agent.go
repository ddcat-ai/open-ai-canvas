package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// v83 internal_agent_worker：/internal-agent Worker 调度面（RFC #943 P3）。
// 版本号从 83 起：78–82 为后续「fork 云端 Agent 子系统批量迁移」保留的号段（将
// 原号原样合入）；上游 v1..77 之后接 v83 形成空号段。迁移器按 MAX(version) 与
// 期望值比较、按计划内版本逐条校验，空号段不参与，无碍。所有租约/恢复时间列
// 的写入与比较一律 UTC：SQLite 文本比较混入本地时区会把未来租约误判为已过期。
const internalAgentWorkerMigrationVersion int64 = 83

func migrateInternalAgentWorker(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.AgentWorker{}, &model.AgentRuntimeInstance{}, &model.AgentSchedulerSetting{}, &model.AgentAdmissionCounter{}); err != nil {
		return err
	}
	// AgentAdmissionCounter 是 claim 的串行化点：事务内 UPDATE 该行会把行锁
	// 持有到 commit（同时是 SQLite 的写锁），保证并发 claim 恰好一个获胜。
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.AgentAdmissionCounter{ID: 1}).Error; err != nil {
		return err
	}
	scheduler := model.DefaultAgentSchedulerSetting()
	scheduler.ID = 1
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&scheduler).Error; err != nil {
		return err
	}
	for _, column := range []struct {
		model any
		field string
	}{
		{&model.CloudAgentExecution{}, "Engine"},         // ''=外部 worker 引入前的旧运行；'pi'=worker 领取
		{&model.CloudAgentExecution{}, "LeaseOwner"},     // 空=未领取
		{&model.CloudAgentExecution{}, "LeaseExpiresAt"}, // NULL=未领取
		{&model.CloudAgentExecution{}, "LeaseEpoch"},     // fencing token：每次 claim +1，释放不清零
		{&model.CloudAgentExecution{}, "RuntimePhase"},   // ready 默认；claim 容量不足时 waiting_resource
		{&model.CloudAgentExecution{}, "NextRecoveryAt"}, // 恢复排程：候选查询排除未到期者
		{&model.CloudAgentExecution{}, "RecoveryAttempts"},
		{&model.CloudAgentExecution{}, "RecoveryStartedAt"},
		{&model.CloudAgentExecution{}, "RecoveryStatus"},
		{&model.CloudAgentExecution{}, "RecoveryLastEpoch"},
	} {
		if !tx.Migrator().HasColumn(column.model, column.field) {
			if err := tx.Migrator().AddColumn(column.model, column.field); err != nil {
				return err
			}
		}
	}
	// AddColumn 不带索引；模型 tag 的默认索引名与这里显式创建的名称一致，两种
	// 数据形态（新建表 / 旧表补列）最终索引名相同。
	for _, idx := range []struct {
		model any
		name  string
	}{
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_lease_expires_at"},
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_next_recovery_at"},
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_engine"},
		{&model.AgentRuntimeInstance{}, "idx_agent_runtime_instances_updated_at"},
		{&model.AgentWorker{}, "idx_agent_workers_user_id"},
	} {
		if !tx.Migrator().HasIndex(idx.model, idx.name) {
			if err := tx.Migrator().CreateIndex(idx.model, idx.name); err != nil {
				return err
			}
		}
	}
	// 存量运行回填：新列成行时旧运行处于「可被领取的初始相位」。
	return tx.Model(&model.CloudAgentExecution{}).
		Where("runtime_phase IS NULL OR runtime_phase = ''").
		UpdateColumn("runtime_phase", "ready").Error
}
