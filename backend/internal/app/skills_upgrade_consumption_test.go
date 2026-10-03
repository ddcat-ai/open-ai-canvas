package app

import (
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestStartupBuiltinSkillPackageIsReadableByAgentAfterRestart(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	dataDir := t.TempDir()
	start := func() *Service {
		svc := New(repository.New(db), dataDir)
		if err := svc.EnsureBuiltinSkills(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureSkillPackages(); err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := start()
	const skillID = "16000000000082"
	const userID = "synthetic-agent-reader"
	if err := db.Create(&model.UserSkillState{ID: "synthetic-state", UserID: userID, SkillID: skillID, Added: true, InstalledVersionID: ""}).Error; err != nil {
		t.Fatal(err)
	}
	var before model.Skill
	if err := db.First(&before, "id = ?", skillID).Error; err != nil {
		t.Fatal(err)
	}
	svc = start()
	var after model.Skill
	if err := db.First(&after, "id = ?", skillID).Error; err != nil {
		t.Fatal(err)
	}
	if before.CurrentVersionID != after.CurrentVersionID || before.ContentHash != after.ContentHash || before.Instruction != after.Instruction {
		t.Fatalf("startup rewrote existing skill: before=%+v after=%+v", before, after)
	}
	detail, err := svc.SkillDetail(userID, skillID)
	if err != nil || !detail.IsAdded || detail.VersionID != before.CurrentVersionID || detail.Instruction != before.Instruction {
		t.Fatalf("skill detail changed: %+v, %v", detail, err)
	}
	files, err := svc.SkillPackageFiles(userID, skillID)
	if err != nil || len(files) < 2 {
		t.Fatalf("multifile package missing: %+v, %v", files, err)
	}
	cardPath := ""
	for _, file := range files {
		if strings.HasPrefix(file.Path, "cards/") && strings.HasSuffix(file.Path, ".md") {
			cardPath = file.Path
			break
		}
	}
	if cardPath == "" {
		t.Fatal("builtin card missing")
	}
	file, err := svc.SkillPackageFile(userID, skillID, cardPath)
	if err != nil || strings.TrimSpace(file.Content) == "" {
		t.Fatalf("reference file unreadable: %+v, %v", file, err)
	}
	bundle, err := svc.SkillPackageBundle(userID, skillID)
	if err != nil || bundle.VersionID != before.CurrentVersionID || len(bundle.Files) != len(files) {
		t.Fatalf("bundle changed: %+v, %v", bundle, err)
	}
	snapshots, err := svc.cloudAgentSkills(userID, []string{skillID})
	if err != nil || len(snapshots) != 1 || snapshots[0].Hash != detail.ContentHash {
		t.Fatalf("Agent snapshot unavailable: %+v, %v", snapshots, err)
	}
	state := &cloudAgentRuntime{Skills: snapshots}
	call := cloudAgentCall{ID: "synthetic-read"}
	call.Function.Name = "skill_read_file"
	call.Function.Arguments = `{"skillId":"` + skillID + `","path":"` + cardPath + `"}`
	result, err := cloudAgentReadTool(svc.repo, userID, state, call, svc)
	if err != nil {
		t.Fatalf("Agent card read failed: %v", err)
	}
	readResult, ok := result.(map[string]any)
	if !ok || readResult["content"] != file.Content {
		t.Fatalf("Agent card read mismatch: %+v, %v", result, err)
	}
	if _, err := svc.cloudAgentSkills("synthetic-uninstalled", []string{skillID}); err == nil {
		t.Fatal("uninstalled user could enable skill for Agent")
	}
	if err := db.Model(&model.UserSkillState{}).Where("id = ?", "synthetic-state").Update("added", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentReadTool(svc.repo, userID, state, call, svc); err == nil {
		t.Fatal("Agent could read a skill after removal from user library")
	}
}
