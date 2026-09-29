package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloudAgentProductionSchedulingDoesNotCallLegacyGoLoop(t *testing.T) {
	root := filepath.Join("..", "..")
	files := []string{
		filepath.Join(root, "internal", "app", "cloud_agent.go"),
		filepath.Join(root, "internal", "app", "cloud_agent_runtime.go"),
		filepath.Join(root, "internal", "app", "task_worker.go"),
	}
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		text := string(body)
		for _, forbidden := range []string{
			"s.advanceCloudAgentByID(",
			"s.advanceCloudAgents()",
		} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("production scheduling still calls legacy Go loop: %s in %s", forbidden, file)
			}
		}
	}
}

func TestCloudAgentPiRuntimeContractUsesGovernedStepBridge(t *testing.T) {
	root := filepath.Join("..", "..")
	coordinator, err := os.ReadFile(filepath.Join(root, "internal", "app", "cloud_agent_pi_coordinator.go"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(coordinator)
	for _, required := range []string{
		"Operation: cloudAgentStepOperation",
		"s.enqueueCloudAgentTask(run, &state, req, nil)",
		"s.waitCloudAgentTask(ctx, taskID)",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("Pi governed model bridge contract missing %q", required)
		}
	}
	runtime, err := os.ReadFile(filepath.Join(root, "internal", "agent", "runtime", "runtime.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(runtime), "mux.HandleFunc(\"POST /model\"") {
		t.Fatal("Pi runtime does not expose the governed /model bridge")
	}
}
