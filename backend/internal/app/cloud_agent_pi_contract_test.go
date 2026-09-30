package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloudAgentProductionSchedulingDoesNotCallLegacyGoLoop(t *testing.T) {
	root := filepath.Join("..", "..")
	// 生产调度入口：Agent 创建、运行时（含拆分出的调度/工具/媒体文件）与任务 worker。
	// 调度循环本身（cloud_agent_runtime_scheduler.go）定义了旧入口，只检查调用方。
	files := []string{
		filepath.Join(root, "internal", "app", "cloud_agent.go"),
		filepath.Join(root, "internal", "app", "cloud_agent_runtime.go"),
		filepath.Join(root, "internal", "app", "cloud_agent_runtime_media.go"),
		filepath.Join(root, "internal", "app", "cloud_agent_runtime_tools.go"),
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
	// 协调器拆分为协调、请求组装、模型桥与消息/工具桥四个文件，合同覆盖整组。
	var coordinator strings.Builder
	for _, name := range []string{"cloud_agent_pi_coordinator.go", "cloud_agent_pi_request.go", "cloud_agent_pi_model.go", "cloud_agent_pi_bridge.go"} {
		body, err := os.ReadFile(filepath.Join(root, "internal", "app", name))
		if err != nil {
			t.Fatal(err)
		}
		coordinator.Write(body)
	}
	text := coordinator.String()
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
