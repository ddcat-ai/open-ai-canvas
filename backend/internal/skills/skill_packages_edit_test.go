package skills

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSkillEditTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	// Both principals are administrators; ownership and private visibility remain distinct.
	createSkillTestUser(t, db, "owner", model.UserRoleAdmin, model.UserStatusActive)
	createSkillTestUser(t, db, "intruder", model.UserRoleAdmin, model.UserStatusActive)
	return New(repository.New(db), t.TempDir(), nil), db
}

func createEditableSkill(t *testing.T, svc *Service, ownerID string, isPrivate bool) *SkillItem {
	t.Helper()
	item, err := svc.CreateSkill(ownerID, SkillMutationRequest{
		SkillName: "分镜助手", Description: "把剧本拆成镜头", Instruction: "# 分镜助手\n\n把剧本拆成镜头。\n", Tag: "creative", IsPrivate: isPrivate,
	})
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func stringPointer(value string) *string { return &value }

func requireAppError(t *testing.T, err error, status int, reason kernel.ErrorReason) {
	t.Helper()
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error = %v, want AppError status %d", err, status)
	}
	if appErr.Status != status || (reason != "" && appErr.Reason != reason) {
		t.Fatalf("error = %d/%s %q, want %d/%s", appErr.Status, appErr.Reason, appErr.Message, status, reason)
	}
}

func TestEditSkillPackageFilesCreatesNewVersion(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	result, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
		BaseVersionID: created.VersionID,
		Operations: []SkillPackageFileOperation{
			{Op: SkillFileOperationWrite, Path: "references/camera.md", Content: stringPointer("# 镜头\n")},
			{Op: SkillFileOperationWrite, Path: "scripts/check.py", Content: stringPointer("print('ok')\n")},
			{Op: SkillFileOperationRename, Path: "scripts/check.py", To: "scripts/verify.py"},
			{Op: SkillFileOperationWrite, Path: "SKILL.md", Content: stringPointer("# 分镜助手\n\n第二版正文。\n")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Changed || result.Skill.VersionID == created.VersionID {
		t.Fatalf("expected a new version, got %#v", result.Skill)
	}
	paths := make([]string, 0, len(result.Files))
	for _, file := range result.Files {
		paths = append(paths, file.Path)
	}
	if strings.Join(paths, ",") != "SKILL.md,references/camera.md,scripts/verify.py" {
		t.Fatalf("files = %v", paths)
	}
	if result.Skill.Instruction != "# 分镜助手\n\n第二版正文。\n" {
		t.Fatalf("instruction not synced from SKILL.md: %q", result.Skill.Instruction)
	}
	if result.Skill.SourceType != "zip" || result.Skill.FileCount != 3 {
		t.Fatalf("multi-file markdown skill should become a package: %#v", result.Skill)
	}
	assertSkillVersionCount(t, db, created.SkillID, 2)
	version, err := svc.repo.SkillVersion(result.Skill.VersionID)
	if err != nil {
		t.Fatal(err)
	}
	body, err := svc.readSkillArchiveEntry(version, "scripts/verify.py")
	if err != nil || string(body) != "print('ok')\n" {
		t.Fatalf("renamed file content = %q, %v", body, err)
	}
	// 重新读取快照会完整校验 ZIP、文件清单与技能行元数据。
	if _, err := svc.SkillPackageFiles("owner", created.SkillID); err != nil {
		t.Fatalf("new version snapshot is inconsistent: %v", err)
	}

	deleted, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
		BaseVersionID: result.Skill.VersionID,
		Operations:    []SkillPackageFileOperation{{Op: SkillFileOperationDelete, Path: "references/camera.md"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted.Files) != 2 {
		t.Fatalf("delete did not remove file: %#v", deleted.Files)
	}
}

func TestEditSkillPackageFilesNoopKeepsVersion(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	result, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
		BaseVersionID: created.VersionID,
		Operations:    []SkillPackageFileOperation{{Op: SkillFileOperationWrite, Path: "SKILL.md", Content: stringPointer(created.Instruction)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Changed || result.Skill.VersionID != created.VersionID {
		t.Fatalf("no-op save must not create a version: %#v", result)
	}
	assertSkillVersionCount(t, db, created.SkillID, 1)
}

func TestEditSkillPackageFilesRequiresOwner(t *testing.T) {
	svc, _ := newSkillEditTestService(t)
	public := createEditableSkill(t, svc, "owner", false)
	private := createEditableSkill(t, svc, "owner", true)
	request := func(skill *SkillItem) SkillPackageEditRequest {
		return SkillPackageEditRequest{BaseVersionID: skill.VersionID, Operations: []SkillPackageFileOperation{{Op: SkillFileOperationWrite, Path: "notes.md", Content: stringPointer("x")}}}
	}
	_, err := svc.EditSkillPackageFiles("intruder", public.SkillID, request(public))
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
	_, err = svc.EditSkillPackageFiles("intruder", private.SkillID, request(private))
	requireAppError(t, err, http.StatusForbidden, kernel.ReasonForbidden)
}

func TestEditSkillPackageFilesRejectsGitHubSkill(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	if err := db.Model(&model.Skill{}).Where("id = ?", created.SkillID).Update("source_type", "github").Error; err != nil {
		t.Fatal(err)
	}
	_, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
		BaseVersionID: created.VersionID,
		Operations:    []SkillPackageFileOperation{{Op: SkillFileOperationWrite, Path: "notes.md", Content: stringPointer("x")}},
	})
	requireAppError(t, err, http.StatusConflict, kernel.ReasonFailedPrecondition)
}

func TestEditSkillPackageFilesRejectsStaleBaseVersion(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	write := func(base string, content string) (*SkillPackageEditResult, error) {
		return svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
			BaseVersionID: base,
			Operations:    []SkillPackageFileOperation{{Op: SkillFileOperationWrite, Path: "notes.md", Content: stringPointer(content)}},
		})
	}
	first, err := write(created.VersionID, "first")
	if err != nil {
		t.Fatal(err)
	}
	_, err = write(created.VersionID, "second")
	requireAppError(t, err, http.StatusConflict, kernel.ReasonSkillVersionConflict)
	var appErr *kernel.AppError
	errors.As(err, &appErr)
	if appErr.Details["currentVersionId"] != first.Skill.VersionID {
		t.Fatalf("conflict details = %#v", appErr.Details)
	}
	_, err = write("", "third")
	requireAppError(t, err, http.StatusConflict, kernel.ReasonSkillVersionConflict)
	assertSkillVersionCount(t, db, created.SkillID, 2)
}

func TestAddSkillVersionIfCurrentIsOptimistic(t *testing.T) {
	svc, db := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	skill, err := svc.repo.Skill(created.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := archiveFromMarkdown([]byte("# 分镜助手\n\n并发写入\n"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	// 模拟两个请求都通过了前置检查：第二个请求在事务内必须因版本已前进而放弃写入。
	if err := svc.addSkillArchiveVersionIfCurrent(skill, archive, "markdown", created.VersionID); err != nil {
		t.Fatal(err)
	}
	stale, err := svc.repo.Skill(created.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	stale.CurrentVersionID = created.VersionID
	err = svc.addSkillArchiveVersionIfCurrent(stale, archive, "markdown", created.VersionID)
	requireAppError(t, err, http.StatusConflict, kernel.ReasonSkillVersionConflict)
	assertSkillVersionCount(t, db, created.SkillID, 2)
}

func TestEditSkillPackageFilesValidatesPathsAndContent(t *testing.T) {
	svc, _ := newSkillEditTestService(t)
	created := createEditableSkill(t, svc, "owner", false)
	seed, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{
		BaseVersionID: created.VersionID,
		Operations:    []SkillPackageFileOperation{{Op: SkillFileOperationWrite, Path: "references/a.md", Content: stringPointer("a")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	text := stringPointer("x")
	cases := map[string]SkillPackageFileOperation{
		"traversal":         {Op: SkillFileOperationWrite, Path: "../escape.md", Content: text},
		"inner traversal":   {Op: SkillFileOperationWrite, Path: "a/../../b.md", Content: text},
		"absolute":          {Op: SkillFileOperationWrite, Path: "/etc/passwd", Content: text},
		"not normalized":    {Op: SkillFileOperationWrite, Path: "a//b.md", Content: text},
		"dot segment":       {Op: SkillFileOperationWrite, Path: "./a.md", Content: text},
		"backslash":         {Op: SkillFileOperationWrite, Path: "a\\b.md", Content: text},
		"git dir":           {Op: SkillFileOperationWrite, Path: ".git/config", Content: text},
		"too deep":          {Op: SkillFileOperationWrite, Path: "1/2/3/4/5/6/7/8/9.md", Content: text},
		"padded segment":    {Op: SkillFileOperationWrite, Path: "a /b.md", Content: text},
		"control char":      {Op: SkillFileOperationWrite, Path: "a\tb.md", Content: text},
		"macos metadata":    {Op: SkillFileOperationWrite, Path: "__MACOSX/a.md", Content: text},
		"missing content":   {Op: SkillFileOperationWrite, Path: "a.md"},
		"oversize text":     {Op: SkillFileOperationWrite, Path: "big.md", Content: stringPointer(strings.Repeat("a", maxSkillPreviewBytes+1))},
		"binary type":       {Op: SkillFileOperationWrite, Path: "cover.png", Content: text},
		"file over folder":  {Op: SkillFileOperationWrite, Path: "references", Content: text},
		"folder over file":  {Op: SkillFileOperationWrite, Path: "references/a.md/b.md", Content: text},
		"delete entry":      {Op: SkillFileOperationDelete, Path: "SKILL.md"},
		"delete missing":    {Op: SkillFileOperationDelete, Path: "missing.md"},
		"rename entry":      {Op: SkillFileOperationRename, Path: "SKILL.md", To: "README.md"},
		"rename onto entry": {Op: SkillFileOperationRename, Path: "references/a.md", To: "SKILL.md"},
		"rename collision":  {Op: SkillFileOperationRename, Path: "references/a.md", To: "SKILL.md/x.md"},
		"unknown op":        {Op: "chmod", Path: "references/a.md"},
	}
	for name, operation := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{BaseVersionID: seed.Skill.VersionID, Operations: []SkillPackageFileOperation{operation}})
			requireAppError(t, err, http.StatusBadRequest, kernel.ReasonInvalidArgument)
		})
	}
	_, err = svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{BaseVersionID: seed.Skill.VersionID})
	requireAppError(t, err, http.StatusBadRequest, kernel.ReasonInvalidArgument)
	tooMany := make([]SkillPackageFileOperation, maxSkillEditOperations+1)
	_, err = svc.EditSkillPackageFiles("owner", created.SkillID, SkillPackageEditRequest{BaseVersionID: seed.Skill.VersionID, Operations: tooMany})
	requireAppError(t, err, http.StatusBadRequest, kernel.ReasonInvalidArgument)
}
