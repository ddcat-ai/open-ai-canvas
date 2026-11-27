package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestBrowserOnlyDeploymentAdmissionAndPolicy(t *testing.T) {
	t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "true")
	s, run, db := browserTestRoot(t)
	if run.ExecutionMode != "browser" {
		t.Fatalf("browser run not admitted: %+v", run)
	}
	for _, mode := range []string{"", "server"} {
		req := agentTestRequest()
		req.ExecutionMode = mode
		_, err := s.CreateCloudAgentRun("user", req, "")
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Reason != "server_agent_disabled" {
			t.Fatalf("server mode %q was not rejected: %v", mode, err)
		}
	}
	policy := defaultRuntimePolicy()
	policy.Task.BrowserAgentEnabled = false
	encoded, _ := json.Marshal(policy)
	if err := db.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	fresh := New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = fresh.Close() })
	effective, err := fresh.RuntimePolicy()
	if err != nil || !effective.Task.BrowserAgentEnabled {
		t.Fatalf("stored policy disabled browser-only deployment: %+v %v", effective, err)
	}
	var actor model.User
	if err := db.First(&actor, "id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	actor.Role = "admin"
	if _, err := fresh.UpdateRuntimePolicySetting(&actor, policy); err == nil {
		t.Fatal("browser-only deployment allowed browser mode to be disabled")
	}
}

func TestBrowserOnlyPolicySavesPreserveCoexistencePreference(t *testing.T) {
	for _, tc := range []struct {
		name       string
		configured bool
		enabled    bool
	}{
		{"saved disabled", true, false},
		{"saved enabled", true, true},
		{"default disabled", false, false},
		{"default enabled", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "false")
			t.Setenv("CANVAS_BROWSER_AGENT_ENABLED", "false")
			if !tc.configured && tc.enabled {
				t.Setenv("CANVAS_BROWSER_AGENT_ENABLED", "true")
			}
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
				t.Fatal(err)
			}
			actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
			svc := New(repository.New(db), t.TempDir())
			t.Cleanup(func() { _ = svc.Close() })
			if tc.configured {
				policy := defaultRuntimePolicy()
				policy.Task.BrowserAgentEnabled = tc.enabled
				if _, err := svc.UpdateRuntimePolicySetting(actor, policy); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "true")
			for i := 0; i < 2; i++ {
				view, err := svc.AdminRuntimePolicySetting(actor)
				if err != nil {
					t.Fatal(err)
				}
				if !view.BrowserAgentOnly || !view.Task.BrowserAgentEnabled {
					t.Fatal("deployment override missing from admin policy")
				}
				view.Task.ActiveTaskLimit = 17 + i
				saved, err := svc.UpdateRuntimePolicySetting(actor, view.RuntimePolicySetting)
				if err != nil {
					t.Fatal(err)
				}
				if !saved.Task.BrowserAgentEnabled {
					t.Fatal("save response lost deployment override")
				}
				var setting model.SystemSetting
				if err := db.First(&setting, "key = ?", runtimePolicySettingKey).Error; err != nil {
					t.Fatal(err)
				}
				var stored RuntimePolicySetting
				if err := json.Unmarshal([]byte(setting.ValueJSON), &stored); err != nil {
					t.Fatal(err)
				}
				if stored.Task.BrowserAgentEnabled != tc.enabled {
					t.Fatalf("stored preference changed: %+v", stored.Task)
				}
				effective, err := svc.RuntimePolicy()
				if err != nil || !effective.Task.BrowserAgentEnabled {
					t.Fatalf("effective override missing: %+v %v", effective, err)
				}
			}
			t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "false")
			view, err := svc.AdminRuntimePolicySetting(actor)
			if err != nil || view.Task.BrowserAgentEnabled != tc.enabled || view.Task.ActiveTaskLimit != 18 {
				t.Fatalf("coexistence preference not restored: %+v %v", view, err)
			}
		})
	}
}

func TestBrowserOnlyDeploymentNeverStartsNode(t *testing.T) {
	t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "true")
	t.Setenv("YINGCE_AGENT_URL", "http://127.0.0.1:1")
	if err := runCloudAgentPi(context.Background(), cloudAgentPiProcessRequest{}, cloudAgentPiBridge{}); err == nil || !strings.Contains(err.Error(), "仅支持浏览器") {
		t.Fatalf("server runtime was not blocked: %v", err)
	}
	s, _, _ := browserTestRoot(t)
	if err := s.applyAgentSessionLimit(context.Background(), 8); err != nil {
		t.Fatalf("browser-only deployment contacted the Node Agent: %v", err)
	}
	agents := s.collectAgentServices(context.Background())
	if len(agents) != 1 || agents[0].Mode != "browser" || !agents[0].Healthy {
		t.Fatalf("unexpected browser-only status: %+v", agents)
	}
}

func TestBrowserOnlyDeploymentExecutesModelAndToolsWithoutNode(t *testing.T) {
	t.Setenv("CANVAS_AGENT_BROWSER_ONLY", "true")
	t.Setenv("YINGCE_AGENT_URL", "http://127.0.0.1:1")
	testBrowserAgentDurableToolRoundTripAndLostAck(t)
}
