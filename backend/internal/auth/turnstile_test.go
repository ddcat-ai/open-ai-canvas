package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

type turnstileRoundTripper func(*http.Request) (*http.Response, error)

func (f turnstileRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestVerifyTurnstileSkipsWhenDisabled(t *testing.T) {
	svc, _ := newPasswordResetTestService(t)
	called := false
	svc.SetTurnstileHTTPClient(&http.Client{Transport: turnstileRoundTripper(func(*http.Request) (*http.Response, error) {
		called = true
		return nil, nil
	})})
	if err := svc.VerifyTurnstile(context.Background(), "", "192.0.2.1"); err != nil {
		t.Fatalf("VerifyTurnstile() disabled error = %v", err)
	}
	if called {
		t.Fatal("disabled Turnstile called Siteverify")
	}
}

func TestVerifyTurnstileChecksSiteverifyAndDoesNotExposeSecret(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	actor := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(actor).Error; err != nil {
		t.Fatal(err)
	}
	setting, err := svc.UpdateTurnstileSetting(actor, TurnstileSettingRequest{Enabled: true, SiteKey: "site-key", SecretKey: "secret-key"})
	if err != nil {
		t.Fatal(err)
	}
	if !setting.Enabled || !setting.HasSecretKey || setting.SiteKey != "site-key" {
		t.Fatalf("public setting = %#v", setting)
	}
	if strings.Contains(strings.ToLower(string(mustJSON(t, setting))), "secret-key") {
		t.Fatal("public setting exposed Turnstile secret")
	}

	called := false
	svc.SetTurnstileHTTPClient(&http.Client{Transport: turnstileRoundTripper(func(req *http.Request) (*http.Response, error) {
		called = true
		if req.URL.String() != turnstileSiteVerifyURL {
			t.Fatalf("Siteverify URL = %s", req.URL)
		}
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatal(err)
		}
		values, err := url.ParseQuery(string(body))
		if err != nil {
			t.Fatal(err)
		}
		if values.Get("secret") != "secret-key" || values.Get("response") != "token" || values.Get("remoteip") != "192.0.2.1" {
			t.Fatalf("Siteverify form = %v", values)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"success":true}`)), Header: make(http.Header)}, nil
	})})
	if err := svc.VerifyTurnstile(context.Background(), "token", "192.0.2.1"); err != nil {
		t.Fatalf("VerifyTurnstile() error = %v", err)
	}
	if !called {
		t.Fatal("Siteverify was not called")
	}
}

func TestVerifyTurnstileFailsClosed(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	if err := db.Create(&model.SystemSetting{Key: turnstileSettingKey, ValueJSON: `{"enabled":true,"siteKey":"site-key","secretKey":"secret-key"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.VerifyTurnstile(context.Background(), "", ""); err == nil {
		t.Fatal("missing Turnstile token succeeded")
	}
	svc.SetTurnstileHTTPClient(&http.Client{Transport: turnstileRoundTripper(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"success":false}`)), Header: make(http.Header)}, nil
	})})
	if err := svc.VerifyTurnstile(context.Background(), "token", ""); err == nil {
		t.Fatal("rejected Siteverify response succeeded")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
