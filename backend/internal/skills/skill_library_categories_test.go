package skills

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSkillLibraryCategoriesVisibilityAssignmentAndDelete(t *testing.T) {
	svc, db := newSkillLibraryCategoryTestService(t)
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}
	otherUser := &model.User{ID: "user-2", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}

	personal, err := svc.CreateSkillLibraryCategory(user, SkillLibraryCategoryMutationRequest{Name: "  Writer\tRoom  "})
	if err != nil {
		t.Fatal(err)
	}
	if personal.Name != "Writer Room" || personal.Scope != "personal" {
		t.Fatalf("personal category = %#v", personal)
	}
	if _, err := svc.CreateSkillLibraryCategory(user, SkillLibraryCategoryMutationRequest{Name: "writer room"}); appErrorStatus(err) != 400 {
		t.Fatalf("duplicate category error = %v, want 400", err)
	}
	secondPersonal, err := svc.CreateSkillLibraryCategory(user, SkillLibraryCategoryMutationRequest{Name: "Characters"})
	if err != nil {
		t.Fatalf("create a different personal category for the same user: %v", err)
	}
	if _, err := svc.CreateSkillLibraryCategory(otherUser, SkillLibraryCategoryMutationRequest{Name: "writer room"}); err != nil {
		t.Fatalf("another user's personal category with the same name should be allowed: %v", err)
	}
	if _, err := svc.CreateSkillLibraryCategory(user, SkillLibraryCategoryMutationRequest{Name: "Shared", Scope: "platform"}); appErrorStatus(err) != 403 {
		t.Fatalf("non-admin platform category error = %v, want 403", err)
	}
	platform, err := svc.CreateSkillLibraryCategory(admin, SkillLibraryCategoryMutationRequest{Name: "Shared", Scope: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateSkillLibraryCategory(user, SkillLibraryCategoryMutationRequest{Name: " shared "}); appErrorStatus(err) != 400 {
		t.Fatalf("personal category colliding with visible platform category error = %v, want 400", err)
	}
	if _, err := svc.CreateSkillLibraryCategory(admin, SkillLibraryCategoryMutationRequest{Name: "Writer Room", Scope: "platform"}); appErrorStatus(err) != 400 {
		t.Fatalf("platform category colliding with an existing personal category error = %v, want 400", err)
	}

	userCategories, err := svc.SkillLibraryCategories(user.ID, "mine")
	if err != nil {
		t.Fatal(err)
	}
	if len(userCategories.Categories) != 3 || !hasLibraryCategory(userCategories.Categories, personal.ID) || !hasLibraryCategory(userCategories.Categories, platform.ID) || !hasLibraryCategory(userCategories.Categories, secondPersonal.ID) {
		t.Fatalf("user-visible categories = %#v", userCategories.Categories)
	}
	otherCategories, err := svc.SkillLibraryCategories(otherUser.ID, "mine")
	if err != nil {
		t.Fatal(err)
	}
	if len(otherCategories.Categories) != 2 || hasLibraryCategory(otherCategories.Categories, personal.ID) {
		t.Fatalf("other user's categories = %#v", otherCategories.Categories)
	}

	for _, skill := range []model.Skill{
		{ID: "joined", OwnerID: "author", Name: "Joined", Status: skillStatusEnabled},
		{ID: "joined-uncategorized", OwnerID: "author", Name: "Joined uncategorized", Status: skillStatusEnabled},
		{ID: "not-joined", OwnerID: "author", Name: "Not joined", Status: skillStatusEnabled},
		{ID: "owned", OwnerID: user.ID, Name: "Owned", Status: skillStatusEnabled, IsPrivate: true},
	} {
		if err := db.Create(&skill).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, state := range []model.UserSkillState{
		{ID: "state-joined", UserID: user.ID, SkillID: "joined", Added: true, LibraryCategoryID: platform.ID},
		{ID: "state-uncategorized", UserID: user.ID, SkillID: "joined-uncategorized", Added: true},
		{ID: "state-other-user", UserID: otherUser.ID, SkillID: "joined", Added: true},
	} {
		if err := db.Create(&state).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SetSkillLibraryCategory(user.ID, "owned", personal.ID); err != nil {
		t.Fatalf("categorize owned skill: %v", err)
	}
	if _, err := svc.SetSkillLibraryCategory(user.ID, "not-joined", personal.ID); appErrorStatus(err) != 403 {
		t.Fatalf("categorize non-joined skill error = %v, want 403", err)
	}
	if _, err := svc.SetSkillLibraryCategory(otherUser.ID, "joined", personal.ID); appErrorStatus(err) != 403 {
		t.Fatalf("use another user's personal category error = %v, want 403", err)
	}
	if _, err := svc.SetSkillLibraryCategory(user.ID, "joined", ""); err != nil {
		t.Fatalf("clear joined skill category: %v", err)
	}
	if _, err := svc.SetSkillLibraryCategory(user.ID, "joined", platform.ID); err != nil {
		t.Fatalf("assign platform category: %v", err)
	}

	userCategories, err = svc.SkillLibraryCategories(user.ID, "mine")
	if err != nil {
		t.Fatal(err)
	}
	if userCategories.TotalCount != 3 || userCategories.UncategorizedCount != 1 || categoryCount(userCategories.Categories, personal.ID) != 1 || categoryCount(userCategories.Categories, platform.ID) != 1 {
		t.Fatalf("mine category counts = %#v", userCategories)
	}
	createdCategories, err := svc.SkillLibraryCategories(user.ID, "created")
	if err != nil {
		t.Fatal(err)
	}
	if createdCategories.TotalCount != 1 || categoryCount(createdCategories.Categories, personal.ID) != 1 || categoryCount(createdCategories.Categories, platform.ID) != 0 {
		t.Fatalf("created category counts = %#v", createdCategories)
	}

	personalSkills, err := svc.Skills(user.ID, SkillListRequest{Scope: "created", PageSize: 80, LibraryCategoryID: personal.ID})
	if err != nil {
		t.Fatal(err)
	}
	if personalSkills.TotalCount != 1 || len(personalSkills.Skills) != 1 || personalSkills.Skills[0].SkillID != "owned" {
		t.Fatalf("personal category filter = %#v", personalSkills)
	}
	if _, err := svc.Skills(user.ID, SkillListRequest{Scope: "created", LibraryCategoryID: personal.ID, LibraryUncategorized: true}); appErrorStatus(err) != 400 {
		t.Fatalf("conflicting library filters error = %v, want 400", err)
	}
	platformSkills, err := svc.Skills(user.ID, SkillListRequest{Scope: "mine", PageSize: 80, LibraryCategoryID: platform.ID})
	if err != nil {
		t.Fatal(err)
	}
	if platformSkills.TotalCount != 1 || len(platformSkills.Skills) != 1 || platformSkills.Skills[0].SkillID != "joined" {
		t.Fatalf("platform category filter = %#v", platformSkills)
	}
	uncategorizedSkills, err := svc.Skills(user.ID, SkillListRequest{Scope: "mine", PageSize: 80, LibraryUncategorized: true})
	if err != nil {
		t.Fatal(err)
	}
	if uncategorizedSkills.TotalCount != 1 || len(uncategorizedSkills.Skills) != 1 || uncategorizedSkills.Skills[0].SkillID != "joined-uncategorized" {
		t.Fatalf("uncategorized filter = %#v", uncategorizedSkills)
	}

	if err := svc.DeleteSkillLibraryCategory(user, personal.ID); err != nil {
		t.Fatal(err)
	}
	owned, err := svc.SkillDetail(user.ID, "owned")
	if err != nil {
		t.Fatal(err)
	}
	if owned.LibraryCategoryID != "" {
		t.Fatalf("deleted personal category reference = %q", owned.LibraryCategoryID)
	}
	var skillCount int64
	if err := db.Model(&model.Skill{}).Count(&skillCount).Error; err != nil {
		t.Fatal(err)
	}
	if skillCount != 4 {
		t.Fatalf("skill count after category deletion = %d, want 4", skillCount)
	}
	if err := svc.DeleteSkillLibraryCategory(user, platform.ID); appErrorStatus(err) != 403 {
		t.Fatalf("non-admin platform category deletion error = %v, want 403", err)
	}
	if err := svc.DeleteSkillLibraryCategory(admin, platform.ID); err != nil {
		t.Fatal(err)
	}
	joined, err := svc.SkillDetail(user.ID, "joined")
	if err != nil {
		t.Fatal(err)
	}
	if joined.LibraryCategoryID != "" {
		t.Fatalf("deleted platform category reference = %q", joined.LibraryCategoryID)
	}
}

func newSkillLibraryCategoryTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SkillLibraryCategory{}, &model.UserSkillState{}, &model.Skill{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir(), nil), db
}

func appErrorStatus(err error) int {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) {
		return appErr.Status
	}
	return 0
}

func hasLibraryCategory(categories []SkillLibraryCategory, id string) bool {
	for _, category := range categories {
		if category.ID == id {
			return true
		}
	}
	return false
}

func categoryCount(categories []SkillLibraryCategory, id string) int64 {
	for _, category := range categories {
		if category.ID == id {
			return category.Count
		}
	}
	return 0
}
