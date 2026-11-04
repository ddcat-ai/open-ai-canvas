package auth

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestLoginModeDefaultsToModal(t *testing.T) {
	db := newAgreementTestDB(t)
	svc := New(repository.New(db), brandHost{name: "星野"}, nil)

	// 尚无账号时走首个管理员分支，同样要下发默认打开方式。
	settings, err := svc.PublicAuthSettings()
	if err != nil {
		t.Fatal(err)
	}
	if !settings.FirstUser || settings.LoginMode != LoginModeModal {
		t.Fatalf("first-user login mode = %q (firstUser=%v)", settings.LoginMode, settings.FirstUser)
	}

	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	// 升级前保存的注册配置没有 loginMode 字段，读取时按弹窗处理。
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true,"agreementTitle":"","agreementContent":""}`}).Error; err != nil {
		t.Fatal(err)
	}
	settings, err = svc.PublicAuthSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.LoginMode != LoginModeModal {
		t.Fatalf("legacy login mode = %q", settings.LoginMode)
	}
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	reloaded, err := svc.AdminRegistrationSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.LoginMode != LoginModeModal {
		t.Fatalf("admin legacy login mode = %q", reloaded.LoginMode)
	}
}

func TestLoginModeSavedAndKeptAcrossOtherUpdates(t *testing.T) {
	db := newAgreementTestDB(t)
	svc := New(repository.New(db), brandHost{name: "星野"}, nil)
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	saved, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: true, LoginMode: strPtr(" Page ")})
	if err != nil {
		t.Fatal(err)
	}
	if saved.LoginMode != LoginModePage {
		t.Fatalf("saved login mode = %q", saved.LoginMode)
	}

	// 注册开关与服务协议单独保存时不带 loginMode，已选择的独立页面模式必须保留。
	if _, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: false, AgreementContent: strPtr("条款正文")}); err != nil {
		t.Fatal(err)
	}
	settings, err := svc.PublicAuthSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.LoginMode != LoginModePage || settings.RegistrationEnabled || settings.AgreementContent != "条款正文" {
		t.Fatalf("public settings = %#v", settings)
	}

	switched, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: false, LoginMode: strPtr(LoginModeModal)})
	if err != nil {
		t.Fatal(err)
	}
	if switched.LoginMode != LoginModeModal || switched.AgreementContent != "条款正文" {
		t.Fatalf("switch back to modal = %#v", switched)
	}
}

func TestLoginModeRejectsUnknownValue(t *testing.T) {
	db := newAgreementTestDB(t)
	svc := New(repository.New(db), brandHost{name: "星野"}, nil)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}

	if _, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: true, LoginMode: strPtr("popup")}); err == nil {
		t.Fatal("unknown login mode should be rejected")
	}
	// 非法值被拒绝时不能写入任何配置。
	reloaded, err := svc.AdminRegistrationSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.LoginMode != LoginModeModal || !reloaded.UpdatedAt.IsZero() {
		t.Fatalf("rejected update was persisted: %#v", reloaded)
	}
}
