package database

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const CurrentSchemaVersion int64 = 104

const baselineSchemaChecksum = "sha256:open-ai-canvas-schema-v1-20260830"
const schemaMigrationAppliedAtIndexChecksum = "sha256:schema-migrations-applied-at-index-v2-20260830"
const assetTaxonomyCandidateIdentityChecksum = "sha256:asset-taxonomy-candidate-identity-v3-20260831-r1"
const resourceUploadKeyChecksum = "sha256:resource-upload-key-v4-20260901"
const paymentTopupChecksum = "sha256:payment-topup-v5-20260902"
const resourcePlaybackChecksum = "sha256:resource-playback-v6-20260902"
const assetLibraryFoldersChecksum = "sha256:asset-library-folders-v6-20260902"
const logicalModelActiveCodeChecksum = "sha256:logical-model-active-code-v8-20260905"
const creationRuntimeChecksum = "sha256:creation-runtime-v10-20260909"
const authNotificationsChecksum = "sha256:auth-notifications-v35-20260924"
const cloudAgentGeminiCacheChecksum = "sha256:cloud-agent-gemini-cache-v36-20260924"
const cloudAgentGeminiCacheIdentityChecksum = "sha256:cloud-agent-gemini-cache-identity-v37-20260925"
const prefixedIDSequenceReconcileChecksum = "sha256:prefixed-id-sequence-reconcile-v38-20260926"
const skillLibraryCategoriesChecksum = "sha256:skill-library-categories-v39-20260926"
const builtinSkillTombstonesChecksum = "sha256:builtin-skill-tombstones-v40-20260927"
const resourceThumbnailChecksum = "sha256:resource-thumbnail-v41-20260927"
const workbenchToolsMigrationName = "workbench_tools_and_presets"
const workbenchToolsMigrationChecksum = "sha256:workbench-tools-presets-v54-20261014"
const legacyWorkbenchToolsMigrationChecksum = "sha256:workbench-tools-presets-v51-20261014"

const postgresSchemaMigrationLockID int64 = 73123910420260830

type SchemaStatus struct {
	Current  int64 `json:"current"`
	Expected int64 `json:"expected"`
	Ready    bool  `json:"ready"`
}

type schemaMigration struct {
	Version   int64     `gorm:"primaryKey"`
	Name      string    `gorm:"size:160;not null"`
	Checksum  string    `gorm:"size:96;not null"`
	AppliedAt time.Time `gorm:"not null"`
}

func (schemaMigration) TableName() string { return "schema_migrations" }

type migration struct {
	version  int64
	name     string
	checksum string
	apply    func(*gorm.DB) error
}

var schemaMigrations = []migration{
	// 44 and 45 are reserved for independent migrations.
	{version: 1, name: "baseline_gorm_schema", checksum: baselineSchemaChecksum, apply: migrateSchemaV1},
	{version: 2, name: "schema_migrations_applied_at_index", checksum: schemaMigrationAppliedAtIndexChecksum, apply: migrateSchemaV2},
	{version: 3, name: "asset_taxonomy_candidate_identity", checksum: assetTaxonomyCandidateIdentityChecksum, apply: migrateSchemaV3},
	{version: 4, name: "resource_upload_key", checksum: resourceUploadKeyChecksum, apply: migrateSchemaV4},
	{version: 5, name: "payment_topup", checksum: paymentTopupChecksum, apply: migrateSchemaV5},
	{version: 6, name: "resource_playback_variant", checksum: resourcePlaybackChecksum, apply: migrateSchemaV6},
	{version: 7, name: "asset_library_folders", checksum: assetLibraryFoldersChecksum, apply: migrateSchemaV7},
	{version: 8, name: "logical_model_active_code", checksum: logicalModelActiveCodeChecksum, apply: migrateSchemaV8},
	{version: 9, name: "channel_presentation", checksum: "sha256:channel-presentation-v9-20260908", apply: migrateChannelPresentation},
	{version: 10, name: "creation_runtime", checksum: creationRuntimeChecksum, apply: migrateSchemaV10},
	{version: 11, name: "cloud_agent_runtime", checksum: "sha256:cloud-agent-runtime-v11-20260912", apply: func(tx *gorm.DB) error { return tx.AutoMigrate(&model.CloudAgentExecution{}) }},
	{version: 12, name: "agent_token_charge_limit", checksum: "sha256:agent-token-charge-limit-v12-20260913", apply: migrateSchemaV12},
	{version: 13, name: "cloud_agent_canvas_mutation", checksum: "sha256:cloud-agent-canvas-mutation-v13-20260913", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentCanvasMutation{})
	}},
	{version: 14, name: "cloud_agent_recovery_control", checksum: "sha256:cloud-agent-recovery-control-v14", apply: migrateSchemaV14},
	{version: 15, name: "agent_profiles", checksum: "sha256:agent-profiles-v15-20260914", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentProfile{})
	}},
	{version: 16, name: "agent_lessons", checksum: "sha256:agent-lessons-v16-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentLesson{})
	}},
	{version: 17, name: "agent_lessons_owner_index", checksum: "sha256:agent-lessons-owner-index-v17-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentLesson{})
	}},
	{version: 18, name: "agent_memory_settings", checksum: "sha256:agent-memory-settings-v18-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentMemorySetting{})
	}},
	{version: 19, name: "payment_plugin_version", checksum: "sha256:payment-plugin-version-v19-20260917", apply: migrateSchemaV19},
	{version: 20, name: "banner_announcements", checksum: "sha256:banner-announcements-v20-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 21, name: "banner_announcement_title_runs", checksum: "sha256:banner-announcement-title-runs-v21-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 22, name: "banner_announcement_notice_type", checksum: "sha256:banner-announcement-notice-type-v22-20260917", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BannerAnnouncement{})
	}},
	{version: 23, name: "canvas_revision_history", checksum: "sha256:canvas-revision-history-v23-20260918", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{})
	}},
	{version: 24, name: "channel_model_label", checksum: "sha256:channel-model-label-v24", apply: migrateChannelModelLabel},
	{version: 25, name: "video_token_formula_snapshot", checksum: "sha256:video-token-formula-snapshot-v25", apply: migrateVideoTokenFormulaSnapshot},
	{version: 26, name: "channel_model_description", checksum: "sha256:channel-model-description-v26", apply: migrateChannelModelDescription},
	{version: 27, name: "channel_credit_cost", checksum: "sha256:channel-credit-cost-v27", apply: migrateChannelCreditCost},
	{version: 28, name: "agent_execution_journal", checksum: "sha256:agent-execution-journal-v28", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.Task{}, &model.BillingOrder{})
	}},
	{version: 29, name: "agent_resource_leases", checksum: "sha256:agent-resource-leases-v29-20260919", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentResourceLease{})
	}},
	{version: 30, name: "builtin_tools", checksum: "sha256:builtin-tools-v30", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.Tool{})
	}},
	{version: 31, name: "tool_favorites", checksum: "sha256:tool-favorites-v31", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.ToolFavorite{})
	}},
	{version: 32, name: "channel_model_tags", checksum: "sha256:channel-model-tags-v32", apply: migrateChannelModelTags},
	{version: 33, name: "oauth_state_accepted_terms", checksum: "sha256:oauth-state-accepted-terms-v33", apply: migrateOAuthStateAcceptedTerms},
	{version: 34, name: "task_media_recovery", checksum: "sha256:task-media-recovery-v34", apply: func(tx *gorm.DB) error {
		for _, field := range []string{"MediaRecoveryJSON", "MediaStage"} {
			if !tx.Migrator().HasColumn(&model.Task{}, field) {
				if err := tx.Migrator().AddColumn(&model.Task{}, field); err != nil {
					return err
				}
			}
		}
		return nil
	}},
	{version: 35, name: "auth_notifications", checksum: authNotificationsChecksum, apply: migrateSchemaV35},
	{version: 36, name: "cloud_agent_gemini_cache", checksum: cloudAgentGeminiCacheChecksum, apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentGeminiCache{})
	}},
	{version: 37, name: "cloud_agent_gemini_cache_identity", checksum: cloudAgentGeminiCacheIdentityChecksum, apply: migrateCloudAgentGeminiCacheIdentity},
	{version: 38, name: "prefixed_id_sequence_reconcile", checksum: prefixedIDSequenceReconcileChecksum, apply: migratePrefixedIDSequenceReconcile},
	{version: 39, name: "skill_library_categories", checksum: skillLibraryCategoriesChecksum, apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.SkillLibraryCategory{}, &model.UserSkillState{})
	}},
	{version: 40, name: "builtin_skill_tombstones", checksum: builtinSkillTombstonesChecksum, apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.BuiltinSkillTombstone{})
	}},
	{version: 41, name: "resource_thumbnail", checksum: resourceThumbnailChecksum, apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.Resource{})
	}},
	{version: 42, name: "cloud_agent_pi_sessions", checksum: "sha256:cloud-agent-pi-sessions-v42-20260928", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CloudAgentPiSession{})
	}},
	{version: 43, name: "topup_sale_strategies", checksum: "sha256:topup-sale-strategies-v43-20260929", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.TopupProduct{}, &model.PaymentOrder{})
	}},
	{version: 45, name: "upload_reservations", checksum: "sha256:upload-reservations-v45-20261005", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.UploadReservation{})
	}},
	{version: 46, name: "skill_curation", checksum: "sha256:skill-curation-v46-20261005", apply: migrateSkillCuration},
	{version: 47, name: "skill_curation_roots", checksum: "sha256:skill-curation-roots-v47-20261005", apply: migrateSkillCurationRoots},
	{version: 48, name: "channel_proxy_url", checksum: "sha256:channel-proxy-url-v48-20261009", apply: func(tx *gorm.DB) error {
		if !tx.Migrator().HasColumn(&model.ModelChannel{}, "ProxyURL") {
			return tx.Migrator().AddColumn(&model.ModelChannel{}, "ProxyURL")
		}
		return nil
	}},
	{version: 49, name: "banner_sort_order", checksum: "sha256:banner-sort-order-v49-20261010", apply: func(tx *gorm.DB) error {
		if !tx.Migrator().HasColumn(&model.BannerAnnouncement{}, "SortOrder") {
			return tx.Migrator().AddColumn(&model.BannerAnnouncement{}, "SortOrder")
		}
		return nil
	}},
	{version: 50, name: "canvas_mutation_receipts", checksum: "sha256:canvas-mutation-receipts-v50-20261011", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CanvasMutationReceipt{})
	}},
	{version: 51, name: "personal_profile_security", checksum: "sha256:personal-profile-security-v51-20261012", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.OAuthState{}, &model.AuthVerification{}, &model.UserAvatar{})
	}},
	{version: 52, name: "user_avatar_presets", checksum: "sha256:user-avatar-presets-v52-20261012", apply: func(tx *gorm.DB) error {
		if tx.Migrator().HasColumn(&model.User{}, "AvatarPreset") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.User{}, "AvatarPreset")
	}},
	{version: 53, name: "user_login_logs", checksum: "sha256:user-login-logs-v53", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.LoginLog{})
	}},
	{version: 54, name: workbenchToolsMigrationName, checksum: workbenchToolsMigrationChecksum, apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.WorkbenchTool{}, &model.WorkbenchPreset{}, &model.Task{})
	}},
	{version: 55, name: "provider_catalog_source", checksum: "sha256:provider-catalog-source-v55", apply: func(tx *gorm.DB) error {
		if !tx.Migrator().HasColumn(&model.ModelChannel{}, "CatalogProviderID") {
			if err := tx.Migrator().AddColumn(&model.ModelChannel{}, "CatalogProviderID"); err != nil {
				return err
			}
		}
		if !tx.Migrator().HasColumn(&model.ChannelModel{}, "CatalogModelKey") {
			return tx.Migrator().AddColumn(&model.ChannelModel{}, "CatalogModelKey")
		}
		return nil
	}},
	{version: 56, name: "sql_perf_indexes", checksum: "sha256:sql-perf-indexes-v56-20261016", apply: migrateSchemaV56},
	{version: 57, name: "canvas_multi_session_sync", checksum: "sha256:canvas-multi-session-sync-v57", apply: migrateCanvasCollaboration},
	{version: 58, name: "agent_memory_proposals", checksum: "sha256:agent-memory-proposals-v58", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.AgentLesson{}, &model.AgentMemorySetting{}, &model.AgentMemoryProposal{}, &model.AgentMemoryRevision{})
	}},
	{version: 59, name: "channel_model_protocol_length", checksum: "sha256:channel-model-protocol-length-v59", apply: migrateChannelModelProtocolLength},
	{version: 60, name: "user_feedbacks", checksum: "sha256:user-feedbacks-v60-20261020", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.UserFeedback{})
	}},
	{version: 61, name: "drama_production", checksum: "sha256:drama-production-v61-20261024", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.DramaProduction{}, &model.DramaCast{}, &model.DramaEpisode{}, &model.DramaShot{}, &model.DramaTake{}, &model.DramaJob{})
	}},
	{version: 62, name: "drama_shot_segments", checksum: "sha256:drama-shot-segments-v62-20261024", apply: func(tx *gorm.DB) error {
		// 镜头级视频模型已随 v67 移到剧情段，这里只补仍存在的列。
		for _, field := range []string{"SegmentIndex", "SegmentTitle"} {
			if !tx.Migrator().HasColumn(&model.DramaShot{}, field) {
				if err := tx.Migrator().AddColumn(&model.DramaShot{}, field); err != nil {
					return err
				}
			}
		}
		return nil
	}},
	{version: 63, name: "drama_job_attempts", checksum: "sha256:drama-job-attempts-v63-20261024", apply: func(tx *gorm.DB) error {
		if tx.Migrator().HasColumn(&model.DramaJob{}, "AttemptsJSON") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.DramaJob{}, "AttemptsJSON")
	}},
	{version: 64, name: "drama_media_release", checksum: "sha256:drama-media-release-v64-20261024", apply: func(tx *gorm.DB) error {
		if !tx.Migrator().HasColumn(&model.DramaProduction{}, "AssetsReleased") {
			if err := tx.Migrator().AddColumn(&model.DramaProduction{}, "AssetsReleased"); err != nil {
				return err
			}
		}
		if !tx.Migrator().HasColumn(&model.DramaEpisode{}, "MediaReleased") {
			return tx.Migrator().AddColumn(&model.DramaEpisode{}, "MediaReleased")
		}
		return nil
	}},
	{version: 65, name: "drama_shot_transition", checksum: "sha256:drama-shot-transition-v65-20261025", apply: func(tx *gorm.DB) error {
		if tx.Migrator().HasColumn(&model.DramaShot{}, "Transition") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.DramaShot{}, "Transition")
	}},
	{version: 66, name: "drama_prompt_overrides", checksum: "sha256:drama-prompt-overrides-v66-20261025", apply: func(tx *gorm.DB) error {
		// 镜头级提示词改写已在 v67 移除，这里只建剧情段表。
		return tx.AutoMigrate(&model.DramaSegment{})
	}},
	{version: 67, name: "drama_segment_production", checksum: "sha256:drama-segment-production-v67-20261026", apply: migrateDramaSegmentProduction},
	{version: 68, name: "drama_segment_revision", checksum: "sha256:drama-segment-revision-v68-20261026", apply: migrateDramaSegmentRevision},
	{version: 69, name: "storage_products", checksum: "sha256:storage-products-v69-20261026", apply: func(tx *gorm.DB) error {
		// 已有商品和订单通过列默认值成为 credits 类型。
		return tx.AutoMigrate(&model.TopupProduct{}, &model.PaymentOrder{}, &model.UserStorageGrant{}, &model.UserStorageState{})
	}},
	{version: 70, name: "resource_offload_jobs", checksum: "sha256:resource-offload-jobs-v70-20261026", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.ResourceOffloadJob{})
	}},
	{version: 71, name: "drama_segment_mode", checksum: "sha256:drama-segment-mode-v71-20261026", apply: migrateDramaSegmentMode},
	{version: 72, name: "referral_center", checksum: "sha256:referral-center-v72-20261027", apply: migrateReferralCenter},
	{version: 73, name: "drama_episode_source_format", checksum: "sha256:drama-episode-source-format-v73-20261027", apply: func(tx *gorm.DB) error {
		// 旧集没有素材类型，空串按小说原文处理。
		if tx.Migrator().HasColumn(&model.DramaEpisode{}, "SourceFormat") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.DramaEpisode{}, "SourceFormat")
	}},
	{version: 74, name: "drama_segment_references", checksum: "sha256:drama-segment-references-v74-20261027", apply: func(tx *gorm.DB) error {
		// 空串表示按镜头自动取参考图，旧段保持原行为。
		if tx.Migrator().HasColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON")
	}},
	{version: 75, name: "user_groups_pricing_currency", checksum: "sha256:user-groups-pricing-currency-v75-20261028", apply: migrateUserGroupsPricingCurrency},
	{version: 76, name: "agent_memory_document_skill_discovery", checksum: "sha256:agent-memory-document-skill-discovery-v76-20261028", apply: migrateAgentMemoryDocumentSkillDiscovery},
	{version: 77, name: "agent_memory_document_columns", checksum: "sha256:agent-memory-document-columns-v77-20261028", apply: migrateAgentMemoryDocumentColumns},
	{version: 78, name: "drama_cast_voice_looks", checksum: "sha256:drama-cast-voice-looks-v78-20261101", apply: migrateDramaCastVoiceLooks},
	{version: 79, name: "ecommerce_agent_and_knowledge", checksum: "sha256:ecommerce-agent-and-knowledge-v79-20261101", apply: migrateEcommerceFeature},
	{version: 80, name: "payment_order_charge_method", checksum: "sha256:payment-order-charge-method-v80-20261104", apply: migratePaymentOrderChargeMethod},
	{version: 81, name: "ark_portrait_assets", checksum: "sha256:ark-portrait-assets-v81-20261104", apply: func(tx *gorm.DB) error {
		// 方舟真人认证会话、用户真人素材组与组内素材；只建新表，不改写可信素材绑定。
		return tx.AutoMigrate(&model.ArkPortraitSession{}, &model.ArkPortraitGroup{}, &model.ArkPortraitAsset{})
	}},
	{version: 82, name: "token_cache_write_price", checksum: "sha256:token-cache-write-price-v82-20261105", apply: migrateTokenCacheWritePrice},
	{version: 83, name: "skill_admin_edits", checksum: "sha256:skill-admin-edits-v83-20261105", apply: migrateSkillAdminEdits},
	{version: 84, name: "token_price_rules", checksum: "sha256:token-price-rules-v84-20261105", apply: migrateTokenPriceRules},
	{version: 85, name: "pose_library", checksum: "sha256:pose-library-v85-20261105", apply: func(tx *gorm.DB) error {
		// 站点级姿势库：来源署名与参考图条目，只建新表；图片文件在数据目录 pose-library/ 下。
		return tx.AutoMigrate(&model.PoseLibrarySource{}, &model.PoseLibraryItem{})
	}},
	{version: 86, name: "ark_asset_groups", checksum: "sha256:ark-asset-groups-v86-20261105", apply: migrateArkAssetGroups},
	{version: 87, name: "inspiration_feed", checksum: "sha256:inspiration-feed-v87-20261105", apply: func(tx *gorm.DB) error {
		// 灵感上新：定时同步的上游灵感条目，只建新表；开关与同步记录存 system_settings。
		return tx.AutoMigrate(&model.InspirationFeedEntry{})
	}},
	{version: 88, name: "reference_video_billing", checksum: "sha256:reference-video-billing-v88-20261106", apply: migrateReferenceVideoBilling},
	{version: 89, name: "reference_video_cost_price", checksum: "sha256:reference-video-cost-price-v89-20261106", apply: migrateReferenceVideoCostPrice},
	{version: 90, name: "drama_draft_form", checksum: "sha256:drama-draft-form-v90-20261106", apply: func(tx *gorm.DB) error {
		// 草稿的创建页表单；旧作品为空串，草稿只能在制作台开工，不能回到创建页。
		if !tx.Migrator().HasTable(&model.DramaProduction{}) || tx.Migrator().HasColumn(&model.DramaProduction{}, "DraftJSON") {
			return nil
		}
		return tx.Migrator().AddColumn(&model.DramaProduction{}, "DraftJSON")
	}},
	{version: 91, name: "email_logs_and_notifications", checksum: "sha256:email-logs-and-notifications-v91-20261106", apply: func(tx *gorm.DB) error {
		// 邮件发送记录与用户邮件订阅（消费日报，默认关闭）；只建新表。
		return tx.AutoMigrate(&model.EmailLog{}, &model.UserNotificationSetting{})
	}},
	{version: 92, name: "drama_reference_controls", checksum: "sha256:drama-reference-controls-v92", apply: func(tx *gorm.DB) error {
		for _, change := range []struct {
			entity any
			fields []string
		}{
			{&model.DramaCast{}, []string{"ImagePrompt"}},
			{&model.DramaSegment{}, []string{"ReferenceImagesJSON", "AudioCastIDsJSON"}},
		} {
			if !tx.Migrator().HasTable(change.entity) {
				continue
			}
			for _, field := range change.fields {
				if !tx.Migrator().HasColumn(change.entity, field) {
					if err := tx.Migrator().AddColumn(change.entity, field); err != nil {
						return err
					}
				}
			}
		}
		return nil
	}},
	{version: 93, name: "ecommerce_round_history", checksum: "sha256:ecommerce-round-history-v93-20261109", apply: func(tx *gorm.DB) error {
		// Additive only: a new table plus a nullable pointer column. Existing
		// projects stay readable and are converted lazily on their next save.
		if err := tx.AutoMigrate(&model.EcommerceProject{}, &model.EcommerceRound{}); err != nil {
			return err
		}
		return nil
	}},
	{version: 94, name: "drama_cast_styles_import", checksum: "sha256:drama-cast-styles-import-v94", apply: migrateDramaCastStylesImport},
	{version: 95, name: "ark_private_asset_binding_identity", checksum: "sha256:ark-private-asset-binding-identity-v95", apply: migrateArkPrivateAssetBindingIdentity},
	{version: 96, name: "canvas_unified_text_nodes", checksum: canvasNodeModelChecksum, apply: migrateCanvasNodeModel},
	{version: 97, name: "channel_websites", checksum: "sha256:channel-websites-v97-20261110", apply: migrateChannelWebsites},
	{version: 98, name: "api_log_generation_content", checksum: "sha256:api-log-generation-content-v98", apply: migrateAPILogGenerationContent},
	{version: 99, name: "site_traffic_events", checksum: "sha256:site-traffic-events-v99-20261111", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.SiteTrafficEvent{})
	}},
	{version: 100, name: "agent_mcp_connections", checksum: "sha256:agent-mcp-connections-v100", apply: migrateAgentMCP},
	{version: 101, name: "creation_conversation_history", checksum: "sha256:creation-conversation-history-v101", apply: func(tx *gorm.DB) error {
		return tx.AutoMigrate(&model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{})
	}},
	{version: 102, name: "wechat_oauth", checksum: "sha256:wechat-oauth-v102", apply: func(tx *gorm.DB) error {
		if !tx.Migrator().HasTable(&model.OAuthState{}) {
			return nil
		}
		for _, field := range []string{"Purpose", "ClientID", "ProfileJSON"} {
			if !tx.Migrator().HasColumn(&model.OAuthState{}, field) {
				if err := tx.Migrator().AddColumn(&model.OAuthState{}, field); err != nil {
					return err
				}
			}
		}
		return nil
	}},
	{version: 103, name: "mcp_tenant_boundaries", checksum: "sha256:mcp-tenant-boundaries-v103", apply: migrateMCPTenantBoundaries},
	{version: 104, name: "agent_storage_limits", checksum: "sha256:agent-storage-limits-v104", apply: migrateAgentStorageLimits},
}

func migrateAPILogGenerationContent(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.ApiCallLog{}) || tx.Migrator().HasColumn(&model.ApiCallLog{}, "GenerationContentJSON") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ApiCallLog{}, "GenerationContentJSON")
}

// migrateReferenceVideoCostPrice 为价格档成本和账单成本快照增加带参考视频的成本价。
// 新列 NOT NULL DEFAULT 0，旧订单的成本口径不变。版本 88 自动开启参考视频计费的全 Token 视频模型，
// 挂参考视频的订单从此按带参考视频成本价记成本：这些 Token 档把带参考视频成本价回填为现有成本价，
// 否则升级后这类订单的成本会记成 0，直到管理员重新保存模型。
func migrateReferenceVideoCostPrice(tx *gorm.DB) error {
	columns := []string{"cost_reference_video_unit_price_microcredits", "cost_reference_video_output_token_price_microcredits"}
	for _, entity := range []any{&model.ChannelModelPriceTier{}, &model.BillingOrder{}} {
		if !tx.Migrator().HasTable(entity) {
			continue
		}
		for _, column := range columns {
			if tx.Migrator().HasColumn(entity, column) {
				continue
			}
			if err := tx.Migrator().AddColumn(entity, column); err != nil {
				return err
			}
		}
	}
	if !tx.Migrator().HasTable(&model.ChannelModel{}) || !tx.Migrator().HasTable(&model.ChannelModelPriceTier{}) {
		return nil
	}
	enabled := tx.Model(&model.ChannelModel{}).Select("id").Where("capability = ? AND reference_video_billing = ?", "video", true)
	return tx.Model(&model.ChannelModelPriceTier{}).
		Where("billing_mode = ? AND channel_model_id IN (?) AND cost_reference_video_output_token_price_microcredits = ?", "token", enabled, 0).
		Update("cost_reference_video_output_token_price_microcredits", gorm.Expr("cost_output_token_price_microcredits")).Error
}

// migrateReferenceVideoBilling 增加视频模型的“参考视频计费”开关、价格档的带参考视频价格和账单的参考视频快照。
// 开关默认关闭；只有已经全部按 Token 计费的视频模型开启开关，并把带参考视频的 Token 价格填成现价，
// 这些模型原本就把参考视频计入公式用量，迁移后扣费结果不变。含按秒价格档的模型保持关闭，
// 避免按秒订单因计入参考视频秒数而悄悄涨价。
func migrateReferenceVideoBilling(tx *gorm.DB) error {
	for _, target := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModel{}, []string{"reference_video_billing"}},
		{&model.ChannelModelPriceTier{}, []string{"reference_video_unit_price_microcredits", "reference_video_output_token_price_microcredits"}},
		{&model.BillingOrder{}, []string{"reference_video_count", "reference_video_millis", "reference_video_billed"}},
	} {
		if !tx.Migrator().HasTable(target.entity) {
			continue
		}
		for _, column := range target.columns {
			if tx.Migrator().HasColumn(target.entity, column) {
				continue
			}
			if err := tx.Migrator().AddColumn(target.entity, column); err != nil {
				return err
			}
		}
	}
	if !tx.Migrator().HasTable(&model.ChannelModel{}) || !tx.Migrator().HasTable(&model.ChannelModelPriceTier{}) {
		return nil
	}
	var tokenModelIDs, perSecondModelIDs []string
	if err := tx.Model(&model.ChannelModelPriceTier{}).Where("billing_mode = ?", "token").Distinct().Pluck("channel_model_id", &tokenModelIDs).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.ChannelModelPriceTier{}).Where("billing_mode = ?", "per_second").Distinct().Pluck("channel_model_id", &perSecondModelIDs).Error; err != nil {
		return err
	}
	excluded := make(map[string]bool, len(perSecondModelIDs))
	for _, id := range perSecondModelIDs {
		excluded[id] = true
	}
	candidates := make([]string, 0, len(tokenModelIDs))
	for _, id := range tokenModelIDs {
		if !excluded[id] {
			candidates = append(candidates, id)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	var videoModelIDs []string
	if err := tx.Model(&model.ChannelModel{}).Where("capability = ? AND id IN ?", "video", candidates).Pluck("id", &videoModelIDs).Error; err != nil {
		return err
	}
	if len(videoModelIDs) == 0 {
		return nil
	}
	if err := tx.Model(&model.ChannelModel{}).Where("id IN ?", videoModelIDs).Update("reference_video_billing", true).Error; err != nil {
		return err
	}
	return tx.Model(&model.ChannelModelPriceTier{}).Where("billing_mode = ? AND channel_model_id IN ?", "token", videoModelIDs).
		Update("reference_video_output_token_price_microcredits", gorm.Expr("output_token_price_microcredits")).Error
}

// migrateArkAssetGroups 把方舟真人素材库扩展为真人 / 虚拟 / 版权 IP 三类素材组：
//   - 会话、素材组、素材补列；旧素材组均为用户自建的真人组，旧素材无需审核。
//   - 新建平台素材组授权表。
//   - 设置 JSON 的 portraitEnabled 改名为 realEnabled，保留管理员已开放的状态。
//   - 由旧版「加入素材库」写入的真人素材（metadata.source=ark-portrait）转为方舟认证分类，
//     并删除已废弃的手动 portraitCertified 标记。
func migrateArkAssetGroups(tx *gorm.DB) error {
	for _, target := range []struct {
		entity  any
		columns []string
	}{
		{&model.ArkPortraitSession{}, []string{"scope", "description", "billing_order_id"}},
		{&model.ArkPortraitGroup{}, []string{"kind", "scope", "description", "grant_all", "authorized_at", "expires_at", "billing_order_id"}},
		{&model.ArkPortraitAsset{}, []string{"library_asset_id", "reviewed_by", "reviewed_at"}},
	} {
		if !tx.Migrator().HasTable(target.entity) {
			continue
		}
		for _, column := range target.columns {
			if tx.Migrator().HasColumn(target.entity, column) {
				continue
			}
			if err := tx.Migrator().AddColumn(target.entity, column); err != nil {
				return fmt.Errorf("补充方舟素材列 %s：%w", column, err)
			}
		}
	}
	for _, index := range []struct {
		entity any
		field  string
	}{
		{&model.ArkPortraitGroup{}, "Kind"},
		{&model.ArkPortraitGroup{}, "Scope"},
		{&model.ArkPortraitAsset{}, "LibraryAssetID"},
	} {
		if !tx.Migrator().HasTable(index.entity) || tx.Migrator().HasIndex(index.entity, index.field) {
			continue
		}
		if err := tx.Migrator().CreateIndex(index.entity, index.field); err != nil {
			return fmt.Errorf("创建方舟素材索引 %s：%w", index.field, err)
		}
	}
	if err := tx.AutoMigrate(&model.ArkPortraitGroupGrant{}); err != nil {
		return fmt.Errorf("创建方舟素材组授权表：%w", err)
	}
	if err := migrateArkPortraitSettingKey(tx); err != nil {
		return err
	}
	return migrateArkPortraitLibraryAssets(tx)
}

func migrateArkPortraitSettingKey(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.SystemSetting{}) {
		return nil
	}
	var setting model.SystemSetting
	err := tx.Where("key = ?", "ark_private_assets").Limit(1).Find(&setting).Error
	if err != nil {
		return fmt.Errorf("读取方舟素材库配置：%w", err)
	}
	if setting.Key == "" || strings.TrimSpace(setting.ValueJSON) == "" {
		return nil
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return fmt.Errorf("解析方舟素材库配置：%w", err)
	}
	legacy, ok := value["portraitEnabled"]
	if !ok {
		return nil
	}
	if _, exists := value["realEnabled"]; !exists {
		value["realEnabled"] = legacy
	}
	delete(value, "portraitEnabled")
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return tx.Model(&model.SystemSetting{}).Where("key = ?", setting.Key).Update("value_json", string(encoded)).Error
}

func migrateArkPortraitLibraryAssets(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Asset{}) {
		return nil
	}
	var assets []model.Asset
	if err := tx.Where("payload_json LIKE ?", `%portraitCertified%`).Find(&assets).Error; err != nil {
		return fmt.Errorf("读取旧人像认证素材：%w", err)
	}
	now := time.Now().UTC()
	for _, asset := range assets {
		var payload map[string]any
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
			// 无法解析的历史记录保持原样，交给现有坏数据隔离逻辑。
			continue
		}
		if _, ok := payload["portraitCertified"]; !ok {
			continue
		}
		delete(payload, "portraitCertified")
		category := asset.Category
		metadata, _ := payload["metadata"].(map[string]any)
		arkAssetID, _ := payload["arkAssetId"].(string)
		if source, _ := metadata["source"].(string); source == "ark-portrait" && strings.TrimSpace(arkAssetID) != "" && asset.Kind == "image" {
			certifiedAt := asset.UpdatedAt
			if certifiedAt.IsZero() {
				certifiedAt = now
			}
			certification := map[string]any{"kind": "real", "scope": "user", "certifiedAt": certifiedAt.UTC().Format(time.RFC3339Nano), "previousCategory": string(asset.Category)}
			if arkGroupID, _ := metadata["arkPortraitGroupId"].(string); arkGroupID != "" {
				certification["arkGroupId"] = arkGroupID
			}
			var portrait model.ArkPortraitAsset
			if tx.Migrator().HasTable(&model.ArkPortraitAsset{}) {
				if err := tx.Where("user_id = ? AND ark_asset_id = ?", asset.UserID, strings.TrimSpace(arkAssetID)).Limit(1).Find(&portrait).Error; err != nil {
					return fmt.Errorf("读取方舟真人素材：%w", err)
				}
			}
			if portrait.ID != "" {
				certification["portraitAssetId"] = portrait.ID
				certification["groupId"] = portrait.GroupID
				if portrait.LibraryAssetID == "" {
					if err := tx.Model(&model.ArkPortraitAsset{}).Where("id = ?", portrait.ID).Update("library_asset_id", asset.ID).Error; err != nil {
						return fmt.Errorf("关联方舟真人素材：%w", err)
					}
				}
			}
			payload["arkCertification"] = certification
			payload["category"] = string(model.AssetCategoryArk)
			category = model.AssetCategoryArk
		}
		payload["updatedAt"] = now.Format(time.RFC3339Nano)
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{"payload_json": string(encoded), "category": category, "updated_at": now}).Error; err != nil {
			return fmt.Errorf("更新旧人像认证素材：%w", err)
		}
	}
	return nil
}

// migrateTokenPriceRules 为 Token 价格档增加分时与上下文规则，为订单增加规则快照与命中序号。
// 旧价格档规则为空且关闭，旧订单快照为空串，结算仍只用基础 Token 单价。
func migrateTokenPriceRules(tx *gorm.DB) error {
	for _, target := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModelPriceTier{}, []string{"token_price_rules_enabled", "token_price_rules"}},
		{&model.BillingOrder{}, []string{"token_price_rules_json", "token_price_rule"}},
	} {
		if !tx.Migrator().HasTable(target.entity) {
			continue
		}
		for _, column := range target.columns {
			if tx.Migrator().HasColumn(target.entity, column) {
				continue
			}
			if err := tx.Migrator().AddColumn(target.entity, column); err != nil {
				return err
			}
		}
	}
	return nil
}

// migrateSkillAdminEdits 为技能增加管理员修改时间。旧技能两列为空，内置技能启动同步和 GitHub 同步行为不变。
func migrateSkillAdminEdits(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Skill{}) {
		return nil
	}
	for _, column := range []string{"admin_info_edited_at", "admin_content_edited_at"} {
		if tx.Migrator().HasColumn(&model.Skill{}, column) {
			continue
		}
		if err := tx.Migrator().AddColumn(&model.Skill{}, column); err != nil {
			return err
		}
	}
	return nil
}

// migrateTokenCacheWritePrice 为文本 Token 定价增加缓存写入单价，为调用日志和账单增加缓存写入用量。
// 新列都是 NOT NULL DEFAULT 0：旧价格档和旧账单的缓存写入不单独收费，结算结果不变。
func migrateTokenCacheWritePrice(tx *gorm.DB) error {
	for _, target := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModel{}, []string{"cache_write_token_price_microcredits"}},
		{&model.ChannelModelPriceTier{}, []string{"cache_write_token_price_microcredits", "cost_cache_write_token_price_microcredits"}},
		{&model.BillingOrder{}, []string{"cache_write_token_price_microcredits", "cost_cache_write_token_price_microcredits", "cache_write_tokens"}},
		{&model.LogicalModel{}, []string{"cache_write_price_microcredits"}},
		{&model.ApiCallLog{}, []string{"cache_write_tokens"}},
	} {
		// 精简部署或旧测试库可能没有某些表；表缺失时由基线 AutoMigrate 按当前结构建表。
		if !tx.Migrator().HasTable(target.entity) {
			continue
		}
		for _, column := range target.columns {
			if tx.Migrator().HasColumn(target.entity, column) {
				continue
			}
			if err := tx.Migrator().AddColumn(target.entity, column); err != nil {
				return err
			}
		}
	}
	return nil
}

// migratePaymentOrderChargeMethod 为支付订单增加实收金额、实收货币、汇率快照和支付方式。
// 旧订单都是按商品货币原价下单，实收金额回填为商品金额，回调与对账校验结果不变。
func migratePaymentOrderChargeMethod(tx *gorm.DB) error {
	for _, field := range []string{"ChargeAmountFen", "ChargeCurrency", "ExchangeRateMicros", "PaymentMethod"} {
		if tx.Migrator().HasColumn(&model.PaymentOrder{}, field) {
			continue
		}
		if err := tx.Migrator().AddColumn(&model.PaymentOrder{}, field); err != nil {
			return err
		}
	}
	return tx.Model(&model.PaymentOrder{}).
		Where("charge_currency = '' OR charge_currency IS NULL").
		Updates(map[string]any{"charge_amount_fen": gorm.Expr("amount_fen"), "charge_currency": gorm.Expr("currency")}).Error
}

// migrateDramaCastVoiceLooks 为短剧设定补角色声音（声音库条目与样本音频）和造型（所属角色、造型名、默认适用章节）。
// 旧设定都是没有指定声音的角色本体，新增列写成零值。
func migrateDramaCastVoiceLooks(tx *gorm.DB) error {
	for _, field := range []string{"VoiceProfileID", "VoiceSampleResourceID", "ParentID", "LookName", "LookFromChapter", "LookToChapter"} {
		if tx.Migrator().HasColumn(&model.DramaCast{}, field) {
			continue
		}
		if err := tx.Migrator().AddColumn(&model.DramaCast{}, field); err != nil {
			return err
		}
	}
	for column, value := range map[string]any{"voice_profile_id": "", "voice_sample_resource_id": "", "parent_id": "", "look_name": "", "look_from_chapter": 0, "look_to_chapter": 0} {
		if err := tx.Model(&model.DramaCast{}).Where(column+" IS NULL").Update(column, value).Error; err != nil {
			return err
		}
	}
	if !tx.Migrator().HasColumn(&model.DramaShot{}, "LookCastIDsJSON") {
		if err := tx.Migrator().AddColumn(&model.DramaShot{}, "LookCastIDsJSON"); err != nil {
			return err
		}
	}
	if err := tx.Model(&model.DramaShot{}).Where("look_cast_ids_json IS NULL").Update("look_cast_ids_json", "").Error; err != nil {
		return err
	}
	if tx.Migrator().HasIndex(&model.DramaCast{}, "ParentID") {
		return nil
	}
	return tx.Migrator().CreateIndex(&model.DramaCast{}, "ParentID")
}

// migrateAgentMemoryDocumentColumns 补齐记忆文件的条目序号与修订的工具调用 ID。
// 早期构建执行 v76 时这两列还不存在，v76 已记为完成不会重跑；新库由 v76 建全，这里是空操作。
func migrateAgentMemoryDocumentColumns(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}); err != nil {
		return err
	}
	// 新增列对旧行是 NULL；写成零值，与新建行一致。
	if err := tx.Model(&model.AgentMemoryDocument{}).Where("next_entry_seq IS NULL").Update("next_entry_seq", 0).Error; err != nil {
		return err
	}
	return tx.Model(&model.AgentMemoryDocumentRevision{}).Where("call_id IS NULL").Update("call_id", "").Error
}

// migrateAgentMemoryDocumentSkillDiscovery 新建用户记忆文件及其修订表，并给用户技能状态补
// Agent 自动发现模式与读取统计列。旧状态 agent_mode 为空，按 auto 处理，行为与“已安装即可发现”一致。
func migrateAgentMemoryDocumentSkillDiscovery(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}); err != nil {
		return err
	}
	for _, field := range []string{"AgentMode", "AgentUseCount", "AgentLastUsedAt"} {
		if tx.Migrator().HasColumn(&model.UserSkillState{}, field) {
			continue
		}
		if err := tx.Migrator().AddColumn(&model.UserSkillState{}, field); err != nil {
			return err
		}
	}
	return nil
}

// migrateUserGroupsPricingCurrency 增加用户分组、分组渠道绑定，以及模型计价货币、充值商品货币和账单分组快照列。
// 旧用户 user_group 为空（归入 default），旧模型按积分计价，旧商品按人民币计价，计费结果不变。
func migrateUserGroupsPricingCurrency(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.UserGroup{}, &model.UserGroupChannel{}); err != nil {
		return err
	}
	columns := []struct {
		model any
		field string
	}{
		{&model.User{}, "UserGroup"},
		{&model.ChannelModel{}, "PriceCurrency"},
		{&model.TopupProduct{}, "Currency"},
		{&model.BillingOrder{}, "UserGroup"},
		{&model.BillingOrder{}, "PriceCurrency"},
		{&model.BillingOrder{}, "CurrencyRateMicrocredits"},
	}
	for _, column := range columns {
		if tx.Migrator().HasColumn(column.model, column.field) {
			continue
		}
		if err := tx.Migrator().AddColumn(column.model, column.field); err != nil {
			return err
		}
	}
	if !tx.Migrator().HasIndex(&model.User{}, "UserGroup") {
		return tx.Migrator().CreateIndex(&model.User{}, "UserGroup")
	}
	return nil
}

// migrateReferralCenter 增加推广人标记和推广码、绑定、返佣三张表；旧用户默认不是推广人。
func migrateReferralCenter(tx *gorm.DB) error {
	if !tx.Migrator().HasColumn(&model.User{}, "IsPromoter") {
		if err := tx.Migrator().AddColumn(&model.User{}, "IsPromoter"); err != nil {
			return err
		}
	}
	if !tx.Migrator().HasIndex(&model.User{}, "IsPromoter") {
		if err := tx.Migrator().CreateIndex(&model.User{}, "IsPromoter"); err != nil {
			return err
		}
	}
	return tx.AutoMigrate(&model.ReferralProfile{}, &model.ReferralBinding{}, &model.ReferralCommission{})
}

// migrateDramaSegmentMode 把旧的剧情段目标秒数改写为新的切段模式：大于 0 的是用户指定的固定时长，0 表示按模型上限，即智能。
func migrateDramaSegmentMode(tx *gorm.DB) error {
	var rows []model.DramaProduction
	if err := tx.Select("project_id", "settings_json").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var settings map[string]any
		if err := json.Unmarshal([]byte(row.SettingsJSON), &settings); err != nil {
			continue
		}
		storyboard, ok := settings["storyboard"].(map[string]any)
		if !ok {
			continue
		}
		if _, done := storyboard["segmentMode"]; done {
			continue
		}
		storyboard["segmentMode"] = "auto"
		if seconds, _ := storyboard["segmentSeconds"].(float64); seconds > 0 {
			storyboard["segmentMode"] = "fixed"
		} else {
			delete(storyboard, "segmentSeconds")
		}
		encoded, err := json.Marshal(settings)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.DramaProduction{}).Where("project_id = ?", row.ProjectID).Update("settings_json", string(encoded)).Error; err != nil {
			return err
		}
	}
	return nil
}

func migrateChannelModelProtocolLength(tx *gorm.DB) error {
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec("ALTER TABLE channel_models ALTER COLUMN protocol TYPE varchar(64)").Error
	}
	return tx.Migrator().AlterColumn(&model.ChannelModel{}, "Protocol")
}

func migratePrefixedIDSequenceReconcile(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.IDSequence{}); err != nil {
		return fmt.Errorf("创建可读 ID 序列表：%w", err)
	}
	return reconcilePrefixedIDSequences(tx)
}

func migrateCloudAgentGeminiCacheIdentity(tx *gorm.DB) error {
	// v36 accidentally made cache_key globally unique while repository reads and
	// writes are user-scoped. Remove that index before creating the explicit
	// (user_id, cache_key) identity used by the model tags.
	for _, name := range []string{"idx_cloud_agent_gemini_caches_cache_key", "idx_cloud_agent_gemini_cache_cache_key"} {
		if tx.Migrator().HasIndex(&model.CloudAgentGeminiCache{}, name) {
			if err := tx.Migrator().DropIndex(&model.CloudAgentGeminiCache{}, name); err != nil {
				return fmt.Errorf("删除 Gemini 缓存旧唯一索引 %s：%w", name, err)
			}
		}
	}
	return tx.AutoMigrate(&model.CloudAgentGeminiCache{})
}

func migrateChannelModelTags(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.ChannelModel{}, "Tags") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ChannelModel{}, "Tags")
}

func migrateOAuthStateAcceptedTerms(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.OAuthState{}, "AcceptedTerms") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.OAuthState{}, "AcceptedTerms")
}

func migrateChannelCreditCost(tx *gorm.DB) error {
	for _, entity := range []any{&model.ChannelModelPriceTier{}, &model.BillingOrder{}} {
		for _, column := range []string{"cost_configured", "cost_unit_price_microcredits", "cost_input_token_price_microcredits", "cost_output_token_price_microcredits", "cost_cached_token_price_microcredits"} {
			if !tx.Migrator().HasColumn(entity, column) {
				if err := tx.Migrator().AddColumn(entity, column); err != nil {
					return err
				}
			}
		}
	}
	for _, column := range []string{"CostBillingMode", "CostQuantity", "CostVideoFormulaTokens"} {
		if !tx.Migrator().HasColumn(&model.BillingOrder{}, column) {
			if err := tx.Migrator().AddColumn(&model.BillingOrder{}, column); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateChannelModelDescription(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.ChannelModel{}, "Description") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ChannelModel{}, "Description")
}

func migrateVideoTokenFormulaSnapshot(tx *gorm.DB) error {
	for _, field := range []string{"VideoFormulaTokens", "UsageSource"} {
		if !tx.Migrator().HasColumn(&model.BillingOrder{}, field) {
			if err := tx.Migrator().AddColumn(&model.BillingOrder{}, field); err != nil {
				return fmt.Errorf("增加视频 Token 结算字段 %s：%w", field, err)
			}
		}
	}
	return nil
}

func migrateChannelModelLabel(tx *gorm.DB) error {
	if tx.Migrator().HasColumn(&model.ChannelModel{}, "ChannelLabel") {
		return nil
	}
	return tx.Migrator().AddColumn(&model.ChannelModel{}, "ChannelLabel")
}

func migrateSchemaV14(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		return err
	}
	// Keep cancellation recoverable for executions admitted before this schema.
	// Bound memory while retaining the migration transaction's all-or-nothing semantics.
	after := ""
	for {
		var runs []model.CloudAgentExecution
		if err := tx.Where("id > ? AND status <> ?", after, "completed").Order("id ASC").Limit(100).Find(&runs).Error; err != nil {
			return err
		}
		if len(runs) == 0 {
			return nil
		}
		for _, run := range runs {
			var state struct {
				Request struct {
					CanvasID string `json:"canvasId"`
				} `json:"request"`
				ActiveTaskID string `json:"activeTaskId"`
				MediaTaskID  string `json:"mediaTaskId"`
			}
			// The root task ID is always a safe cancellation anchor. If an old
			// transcript is damaged, retain a durable warning and cancel that
			// root task during recovery instead of blocking the whole deployment.
			updates := map[string]any{"active_task_id": run.ID}
			if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
				updates["failure_message"] = "旧 Agent 运行记录损坏，已保留根任务并进入安全收尾；请核对任务中心"
			} else {
				updates["canvas_id"] = state.Request.CanvasID
				if state.ActiveTaskID != "" {
					updates["active_task_id"] = state.ActiveTaskID
				}
				updates["media_task_id"] = state.MediaTaskID
			}
			if run.Status == "cancelled" || run.Status == "failed" {
				updates["cleanup_pending"] = true
			}
			if err := tx.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Updates(updates).Error; err != nil {
				return err
			}
			after = run.ID
		}
	}
}

func migrateChannelPresentation(tx *gorm.DB) error {
	for _, column := range []struct {
		model any
		field string
	}{{&model.ModelChannel{}, "PublicAlias"}, {&model.ModelChannel{}, "SortOrder"}, {&model.ChannelModel{}, "SortOrder"}} {
		if !tx.Migrator().HasColumn(column.model, column.field) {
			if err := tx.Migrator().AddColumn(column.model, column.field); err != nil {
				return err
			}
		}
	}
	return nil
}

func migrationsForDatabase(db *gorm.DB) ([]migration, error) {
	var applied schemaMigration
	err := db.First(&applied, "version = ?", 6).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return schemaMigrations, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取数据库迁移 6：%w", err)
	}
	if applied.Name != "asset_library_folders" {
		return schemaMigrations, nil
	}
	legacy := migration{version: 6, name: "asset_library_folders", checksum: assetLibraryFoldersChecksum, apply: migrateSchemaV7}
	if err := validateMigrationRecord(applied, legacy); err != nil {
		return nil, err
	}
	plan := append([]migration(nil), schemaMigrations...)
	for index, item := range plan {
		switch item.version {
		case 6:
			plan[index] = legacy
		case 7:
			plan[index] = migration{version: 7, name: "resource_playback_variant", checksum: resourcePlaybackChecksum, apply: migrateSchemaV6}
		}
	}
	return plan, nil
}

func migrateSchemaV2(tx *gorm.DB) error {
	return tx.Exec("CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations (applied_at)").Error
}

func migrateSchemaV3(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.ProjectAssetCandidate{}); err != nil {
		return fmt.Errorf("扩展资产候选身份字段：%w", err)
	}
	if err := tx.Exec("UPDATE assets SET category = 'prop' WHERE category IN ('wardrobe', 'weapon', 'accessory')").Error; err != nil {
		return fmt.Errorf("合并资产道具分类：%w", err)
	}
	if err := tx.Exec("UPDATE assets SET category = 'material' WHERE category = 'style' OR (category = 'other' AND kind IN ('image', 'video', 'audio', 'model'))").Error; err != nil {
		return fmt.Errorf("迁移资产素材分类：%w", err)
	}
	if err := tx.Exec("UPDATE project_asset_candidates SET category = 'prop' WHERE category IN ('wardrobe', 'weapon', 'accessory')").Error; err != nil {
		return fmt.Errorf("合并候选道具分类：%w", err)
	}
	if err := tx.Exec("UPDATE project_asset_candidates SET category = 'material' WHERE category = 'style'").Error; err != nil {
		return fmt.Errorf("迁移候选素材分类：%w", err)
	}
	var candidates []model.ProjectAssetCandidate
	if err := tx.Order("created_at asc, id asc").Find(&candidates).Error; err != nil {
		return fmt.Errorf("读取资产候选身份：%w", err)
	}
	seenPending := make(map[string]string, len(candidates))
	for _, candidate := range candidates {
		nameKey := model.AssetCandidateNameKey(candidate.Name)
		updates := map[string]any{"name_key": nameKey}
		identity := candidate.ProjectID + ":" + string(candidate.Category) + ":" + nameKey
		if candidate.Status == "pending_confirmation" && nameKey != "" {
			if _, exists := seenPending[identity]; exists {
				updates["status"] = "ignored"
			} else {
				seenPending[identity] = candidate.ID
			}
		}
		if err := tx.Model(&model.ProjectAssetCandidate{}).Where("id = ?", candidate.ID).Updates(updates).Error; err != nil {
			return fmt.Errorf("回填资产候选身份 %s：%w", candidate.ID, err)
		}
	}
	return tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_asset_candidates_pending_identity ON project_asset_candidates(project_id, category, name_key) WHERE status = 'pending_confirmation' AND name_key <> ''").Error
}

func migrateSchemaV4(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Resource{}) {
		return fmt.Errorf("资源表不存在")
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "upload_key") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "UploadKey"); err != nil {
			return fmt.Errorf("增加资源上传幂等列：%w", err)
		}
	}
	if err := tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_user_upload_key ON resources (user_id, upload_key)").Error; err != nil {
		return fmt.Errorf("创建资源上传幂等索引：%w", err)
	}
	return nil
}
func migrateSchemaV5(tx *gorm.DB) error {
	if err := tx.AutoMigrate(
		&model.CreditLedgerEntry{},
		&model.TopupProduct{},
		&model.PaymentProviderConfig{},
		&model.PaymentOrder{},
		&model.PaymentNotification{},
		&model.PaymentReconciliationRun{},
		&model.PaymentReconciliationItem{},
	); err != nil {
		return fmt.Errorf("创建积分支付与对账结构：%w", err)
	}
	return nil
}

func migrateSchemaV19(tx *gorm.DB) error {
	for _, value := range []any{&model.PaymentProviderConfig{}, &model.PaymentOrder{}} {
		if !tx.Migrator().HasTable(value) {
			continue
		}
		if err := addPaymentPluginVersionColumn(tx, value); err != nil {
			return err
		}
	}
	return nil
}

func addPaymentPluginVersionColumn(tx *gorm.DB, value any) error {
	if tx.Migrator().HasColumn(value, "plugin_version") {
		return nil
	}
	if err := tx.Migrator().AddColumn(value, "PluginVersion"); err != nil {
		return fmt.Errorf("增加支付插件版本列：%w", err)
	}
	return nil
}

func migrateSchemaV6(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Resource{}) {
		return fmt.Errorf("资源表不存在")
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_status") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackStatus"); err != nil {
			return fmt.Errorf("增加播放副本状态列：%w", err)
		}
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_object_key") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackObjectKey"); err != nil {
			return fmt.Errorf("增加播放副本对象键列：%w", err)
		}
	}
	if !tx.Migrator().HasColumn(&model.Resource{}, "playback_error") {
		if err := tx.Migrator().AddColumn(&model.Resource{}, "PlaybackError"); err != nil {
			return fmt.Errorf("增加播放副本错误列：%w", err)
		}
	}
	return nil
}

func migrateSchemaV7(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.Asset{}, &model.AssetFolder{}); err != nil {
		return fmt.Errorf("创建个人素材分类并扩展素材目录字段：%w", err)
	}
	return nil
}

func migrateSchemaV8(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.LogicalModel{}) {
		return nil
	}
	if err := tx.Exec("DROP INDEX IF EXISTS idx_logical_models_code").Error; err != nil {
		return fmt.Errorf("移除前台模型旧 code 唯一索引：%w", err)
	}
	if err := tx.Exec("CREATE UNIQUE INDEX idx_logical_models_code ON logical_models(code) WHERE archived_at IS NULL").Error; err != nil {
		return fmt.Errorf("创建前台模型活动 code 唯一索引：%w", err)
	}
	return nil
}

// migrateSchemaV10 只增加创作运行时表和任务幂等关联；旧任务的空 submission ID 必须继续合法。
func migrateSchemaV10(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CreationRun{}, &model.CreationSubmission{}, &model.Task{}); err != nil {
		return fmt.Errorf("创建创作运行时结构：%w", err)
	}
	return nil
}

// migrateSchemaV12 为 Agent 的 Token 计费增加最终扣费上限；旧账单保持 0，继续沿用既有按 usage 结算语义。
func migrateSchemaV12(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.BillingOrder{}) {
		return nil
	}
	if tx.Migrator().HasColumn(&model.BillingOrder{}, "ChargeLimitMicrocredits") {
		return nil
	}
	if err := tx.Migrator().AddColumn(&model.BillingOrder{}, "ChargeLimitMicrocredits"); err != nil {
		return fmt.Errorf("增加 Agent Token 扣费上限列：%w", err)
	}
	return nil
}

func normalizeLegacyWorkbenchMigration(tx *gorm.DB) error {
	var legacy schemaMigration
	if err := tx.First(&legacy, "version = ?", 51).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return fmt.Errorf("读取旧工作台迁移记录：%w", err)
	}
	if legacy.Name != workbenchToolsMigrationName || legacy.Checksum != legacyWorkbenchToolsMigrationChecksum {
		return nil
	}

	var later []schemaMigration
	if err := tx.Where("version > ?", legacy.Version).Order("version asc").Find(&later).Error; err != nil {
		return fmt.Errorf("读取旧工作台迁移后的记录：%w", err)
	}
	if len(later) > 0 {
		return fmt.Errorf("数据库迁移 51 使用旧工作台身份，但已存在后续迁移记录 %d；拒绝自动改写迁移账本", later[0].Version)
	}
	if !tx.Migrator().HasTable(&model.WorkbenchTool{}) || !tx.Migrator().HasTable(&model.WorkbenchPreset{}) {
		return fmt.Errorf("数据库迁移 51 记录为旧工作台迁移，但工作台表不完整；请从备份恢复后再升级")
	}

	result := tx.Model(&schemaMigration{}).
		Where("version = ? AND name = ? AND checksum = ?", legacy.Version, legacy.Name, legacy.Checksum).
		Updates(map[string]any{
			"version":  workbenchToolsMigrationVersion,
			"name":     workbenchToolsMigrationName,
			"checksum": workbenchToolsMigrationChecksum,
		})
	if result.Error != nil {
		return fmt.Errorf("归一化旧工作台迁移记录：%w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("归一化旧工作台迁移记录影响 %d 行，拒绝继续启动", result.RowsAffected)
	}
	return nil
}

const workbenchToolsMigrationVersion int64 = 54

func migrateSchemaV56(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.ApiCallLog{}, &model.Task{}, &model.CreditLedgerEntry{}); err != nil {
		return fmt.Errorf("迁移 SQL 性能索引：%w", err)
	}
	if tx.Dialector.Name() == "sqlite" {
		if err := tx.Exec("UPDATE api_call_logs SET created_at_epoch = unixepoch(created_at) WHERE created_at_epoch = 0 OR created_at_epoch IS NULL").Error; err != nil {
			return fmt.Errorf("回填 api_call_logs 时间戳：%w", err)
		}
		if err := tx.Exec("UPDATE tasks SET created_at_epoch = unixepoch(created_at) WHERE created_at_epoch = 0 OR created_at_epoch IS NULL").Error; err != nil {
			return fmt.Errorf("回填 tasks 时间戳：%w", err)
		}
	}
	return nil
}

func MigrateSchema(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", postgresSchemaMigrationLockID).Error; err != nil {
				return fmt.Errorf("获取数据库迁移锁：%w", err)
			}
		}
		if err := tx.AutoMigrate(&schemaMigration{}); err != nil {
			return fmt.Errorf("初始化数据库迁移记录：%w", err)
		}
		if err := normalizeLegacyWorkbenchMigration(tx); err != nil {
			return err
		}
		plan, err := migrationsForDatabase(tx)
		if err != nil {
			return err
		}
		for _, item := range plan {
			var applied schemaMigration
			err := tx.First(&applied, "version = ?", item.version).Error
			if err == nil {
				if err := validateMigrationRecord(applied, item); err != nil {
					return err
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("读取数据库迁移 %d：%w", item.version, err)
			}
			if err := item.apply(tx); err != nil {
				return fmt.Errorf("执行数据库迁移 %d（%s）：%w", item.version, item.name, err)
			}
			record := schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}
			if err := tx.Create(&record).Error; err != nil {
				return fmt.Errorf("记录数据库迁移 %d：%w", item.version, err)
			}
		}
		return RequireSchemaVersion(tx)
	})
}

func ReadSchemaStatus(db *gorm.DB) (SchemaStatus, error) {
	status := SchemaStatus{Expected: CurrentSchemaVersion}
	if !db.Migrator().HasTable(&schemaMigration{}) {
		return status, nil
	}
	if err := db.Model(&schemaMigration{}).Select("COALESCE(MAX(version), 0)").Scan(&status.Current).Error; err != nil {
		return status, fmt.Errorf("读取数据库结构版本：%w", err)
	}
	if status.Current != status.Expected {
		return status, nil
	}
	if err := validateMigrationRecords(db); err != nil {
		return status, err
	}
	status.Ready = true
	return status, nil
}

func validateMigrationRecords(db *gorm.DB) error {
	plan, err := migrationsForDatabase(db)
	if err != nil {
		return err
	}
	for _, item := range plan {
		var applied schemaMigration
		if err := db.First(&applied, "version = ?", item.version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("数据库缺少迁移记录 %d（%s）", item.version, item.name)
			}
			return fmt.Errorf("读取数据库迁移 %d：%w", item.version, err)
		}
		if err := validateMigrationRecord(applied, item); err != nil {
			return err
		}
	}
	return nil
}

func validateMigrationRecord(applied schemaMigration, expected migration) error {
	if applied.Name != expected.name {
		return fmt.Errorf("数据库迁移 %d 名称不一致：记录为 %s，程序期望 %s", expected.version, applied.Name, expected.name)
	}
	if applied.Checksum != expected.checksum {
		return fmt.Errorf("数据库迁移 %d 校验和不一致：记录为 %s，程序期望 %s", expected.version, applied.Checksum, expected.checksum)
	}
	return nil
}

func RequireSchemaVersion(db *gorm.DB) error {
	status, err := ReadSchemaStatus(db)
	if err != nil {
		return err
	}
	if status.Current < status.Expected {
		return fmt.Errorf("数据库结构版本过旧：当前 %d，程序要求 %d，请先执行 migrate-schema up", status.Current, status.Expected)
	}
	if status.Current > status.Expected {
		return fmt.Errorf("数据库结构版本 %d 高于程序支持的 %d，拒绝使用旧程序连接新数据库", status.Current, status.Expected)
	}
	return nil
}

// migrateDramaSegmentProduction 把短剧制作从“每镜配音 + 首帧 + 单镜视频”改为“每个剧情段生成一个带对白的视频”：
// 先把旧媒体槽位归档到版本库，暂停旧工作，然后删除逐镜媒体列。
func migrateDramaSegmentProduction(tx *gorm.DB) error {
	// Archive current legacy slots before removing their columns. Takes and resources are never deleted.
	legacy := false
	for _, slot := range []struct{ column, kind string }{{"audio_resource_id", "audio"}, {"frame_resource_id", "frame"}, {"video_resource_id", "video"}} {
		if !tx.Migrator().HasColumn(&model.DramaShot{}, slot.column) {
			continue
		}
		legacy = true
		var rows []struct {
			ID, ProjectID, ResourceID string
			DurationMs                int64
		}
		if err := tx.Model(&model.DramaShot{}).Select("id,project_id,duration_ms," + slot.column + " AS resource_id").Where(slot.column + " IS NOT NULL AND " + slot.column + " <> ''").Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			var count int64
			if err := tx.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ? AND resource_id = ?", row.ID, slot.kind, row.ResourceID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			var version int
			if err := tx.Model(&model.DramaTake{}).Where("owner_id = ? AND kind = ?", row.ID, slot.kind).Select("COALESCE(MAX(version),0)").Scan(&version).Error; err != nil {
				return err
			}
			take := model.DramaTake{ID: kernel.NewID(), ProjectID: row.ProjectID, OwnerID: row.ID, Kind: slot.kind, Version: version + 1, ResourceID: row.ResourceID, DurationMs: row.DurationMs, Prompt: "逐镜流程迁移保留的历史产物", CreatedAt: time.Now()}
			if err := tx.Create(&take).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.AutoMigrate(&model.DramaSegment{}); err != nil {
		return err
	}
	if !tx.Migrator().HasColumn(&model.DramaShot{}, "PropIDsJSON") {
		if err := tx.Migrator().AddColumn(&model.DramaShot{}, "PropIDsJSON"); err != nil {
			return err
		}
	}
	if !tx.Migrator().HasColumn(&model.DramaEpisode{}, "Approved") {
		if err := tx.Migrator().AddColumn(&model.DramaEpisode{}, "Approved"); err != nil {
			return err
		}
	}
	if legacy {
		if err := tx.Model(&model.DramaProduction{}).Where("project_id IN (?)", tx.Model(&model.DramaEpisode{}).Select("project_id").Where("stage <> ?", "done")).Updates(map[string]any{"status": "paused", "pause_reason": "已切换剧情段制作，请核对剧本、视频模型并重新改编未完成的集；历史产物已保留", "revision": gorm.Expr("revision + 1")}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.DramaEpisode{}).Where("stage <> ?", "done").Updates(map[string]any{"stage": "script", "media_released": false, "approved": false, "error": "旧逐镜流程已停用，请确认设置后点击重新改编", "revision": gorm.Expr("revision + 1")}).Error; err != nil {
			return err
		}
	}
	if err := tx.Model(&model.DramaJob{}).Where("kind IN ? AND status IN ?", []string{"voice", "frame", "video"}, []string{"queued", "running"}).Updates(map[string]any{"status": "canceled", "error": "已切换剧情段制作，原任务保留在任务记录中", "finished_at": time.Now()}).Error; err != nil {
		return err
	}
	if legacy {
		if err := tx.Model(&model.DramaJob{}).Where("status IN ?", []string{"queued", "running"}).Updates(map[string]any{"status": "canceled", "error": "旧制作流程已暂停，禁止自动重发", "finished_at": time.Now()}).Error; err != nil {
			return err
		}
	}
	for _, column := range []string{"video_model_json", "speaker_cast_id", "frame_prompt_override", "video_prompt_override", "audio_resource_id", "audio_duration_ms", "audio_status", "frame_resource_id", "frame_status", "video_resource_id", "video_status", "approved", "locked", "error"} {
		if tx.Migrator().HasColumn(&model.DramaShot{}, column) {
			if err := tx.Migrator().DropColumn(&model.DramaShot{}, column); err != nil {
				return fmt.Errorf("删除旧镜头列 %s: %w", column, err)
			}
		}
	}
	if tx.Migrator().HasColumn(&model.DramaCast{}, "voice_key") {
		if err := tx.Migrator().DropColumn(&model.DramaCast{}, "voice_key"); err != nil {
			return err
		}
	}
	if tx.Migrator().HasColumn(&model.DramaEpisode{}, "frames_approved") {
		if err := tx.Migrator().DropColumn(&model.DramaEpisode{}, "frames_approved"); err != nil {
			return err
		}
	}
	return nil
}

func migrateDramaSegmentRevision(tx *gorm.DB) error {
	if err := migrateDramaSegmentProduction(tx); err != nil {
		return err
	}
	if err := tx.AutoMigrate(&model.DramaCast{}, &model.DramaSegment{}); err != nil {
		return err
	}
	// v67 installations may already have segment work in flight without revision snapshots.
	if err := tx.Model(&model.DramaProduction{}).Where("project_id IN (?)", tx.Model(&model.DramaJob{}).Select("project_id").Where("kind IN ? AND status IN ?", []string{"segment_prompt", "segment_video", "render", "script"}, []string{"queued", "running"})).Updates(map[string]any{"status": "paused", "pause_reason": "制作合同已升级，请核对任务记录后重试或重新改编"}).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.DramaSegment{}).Where("prompt_status = ?", "running").Updates(map[string]any{"prompt_status": "failed", "prompt_error": "任务合同升级，请核对原任务后重试"}).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.DramaSegment{}).Where("video_status IN ?", []string{"running", "queued"}).Updates(map[string]any{"video_status": "failed", "video_error": "任务合同升级，请核对原任务后重试"}).Error; err != nil {
		return err
	}
	return tx.Model(&model.DramaJob{}).Where("status IN ?", []string{"queued", "running"}).Updates(map[string]any{"status": "canceled", "error": "任务合同升级，原任务保留，需人工核对", "finished_at": time.Now()}).Error
}
