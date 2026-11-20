package app

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"yingce/backend/internal/hostupdate"
	"yingce/backend/internal/model"
	"yingce/backend/internal/updaterclient"
)

type sourceUpdateManagerStub struct {
	UpdateManager
	sources hostupdate.Sources
	calls   int
	err     error
}

func (m *sourceUpdateManagerStub) SaveSources(_ context.Context, sources hostupdate.Sources) (hostupdate.Status, error) {
	m.calls++
	m.sources = sources
	return hostupdate.Status{Sources: &sources}, m.err
}

func (m *sourceUpdateManagerStub) TestSources(context.Context) (hostupdate.Status, error) {
	m.calls++
	return hostupdate.Status{}, m.err
}

func TestAdminUpdateSourcesAuthorizationAndValidation(t *testing.T) {
	manager := &sourceUpdateManagerStub{}
	svc := &Service{updateManager: manager}
	ctx := context.Background()
	sources := hostupdate.Sources{GitHubSource: "gh_proxy", ImageSource: "nju"}
	for _, actor := range []*model.User{nil, {ID: "user", Role: model.UserRoleUser}} {
		if _, err := svc.AdminSaveUpdateSources(ctx, actor, sources); err == nil {
			t.Fatal("non-admin saved sources")
		}
		if _, err := svc.AdminTestUpdateSources(ctx, actor); err == nil {
			t.Fatal("non-admin started probe")
		}
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	if _, err := svc.AdminSaveUpdateSources(ctx, admin, hostupdate.Sources{GitHubSource: "https://untrusted.invalid", ImageSource: "nju"}); err == nil {
		t.Fatal("arbitrary source accepted")
	}
	if manager.calls != 0 {
		t.Fatal("unauthorized or invalid request reached updater")
	}
	status, err := svc.AdminSaveUpdateSources(ctx, admin, sources)
	if err != nil || status.Sources == nil || *status.Sources != sources || manager.sources != sources {
		t.Fatal("valid configuration not forwarded", err)
	}
	if _, err := svc.AdminTestUpdateSources(ctx, admin); err != nil {
		t.Fatal(err)
	}
	if manager.calls != 2 {
		t.Fatal("unexpected updater calls")
	}
}

func TestAdminUpdateSourcesPreservesConflictStatus(t *testing.T) {
	manager := &sourceUpdateManagerStub{err: &updaterclient.ResponseError{StatusCode: http.StatusConflict, Message: "busy"}}
	svc := &Service{updateManager: manager}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	_, err := svc.AdminTestUpdateSources(context.Background(), admin)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
		t.Fatalf("error=%v", err)
	}
}
