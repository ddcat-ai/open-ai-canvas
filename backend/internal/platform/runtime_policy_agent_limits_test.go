package platform

import "testing"

func TestAgentStepTimeoutEnvironmentBounds(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{
		{"-1", 0}, {"0", 0}, {"1", 30}, {"29", 30}, {"30", 30}, {"90", 90}, {"3601", 3600},
	} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("CANVAS_AGENT_STEP_TIMEOUT_SECONDS", tc.value)
			if got := agentStepTimeoutSecondsDefault(); got != tc.want {
				t.Fatalf("timeout = %d, want %d", got, tc.want)
			}
		})
	}
}
