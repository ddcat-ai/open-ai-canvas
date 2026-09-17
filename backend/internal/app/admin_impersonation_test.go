package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestUpdateUserRevokesImpersonationOnSecurityChanges(t *testing.T) {
	for _, scenario := range []string{"role", "status", "password", "display-name"} {
		t.Run(scenario, func(t *testing.T) {
			db := newBulkUserTestDB(t)
			actor := model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
			target := model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
			if err := db.Create(&[]model.User{actor, target}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&[]model.AuthSession{
				{ID: "regular", UserID: target.ID},
				{ID: "impersonating-target", UserID: target.ID, ImpersonatorUserID: actor.ID},
				{ID: "issued-by-target", UserID: "another-user", ImpersonatorUserID: target.ID},
				{ID: "unrelated", UserID: actor.ID},
			}).Error; err != nil {
				t.Fatal(err)
			}
			svc := &Service{repo: repository.New(db)}
			req := UpdateUserRequest{}
			switch scenario {
			case "role":
				req.Role = model.UserRoleAdmin
			case "status":
				req.Status = model.UserStatusDisabled
			case "password":
				req.Password = "new-password"
			case "display-name":
				req.DisplayName = "New Name"
			}
			if _, err := svc.UpdateUser(&actor, target.ID, req); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.UpdateUser(&actor, target.ID, UpdateUserRequest{Role: model.UserRoleUser, Status: model.UserStatusActive}); err != nil {
				t.Fatal(err)
			}
			var sessions []model.AuthSession
			if err := db.Find(&sessions).Error; err != nil {
				t.Fatal(err)
			}
			if scenario == "display-name" {
				if len(sessions) != 4 {
					t.Fatalf("profile edit revoked sessions: %#v", sessions)
				}
			} else if len(sessions) != 1 || sessions[0].ID != "unrelated" {
				t.Fatalf("security edit retained sessions: %#v", sessions)
			}
		})
	}
}
