package ecommerceagent

import (
	"strings"
	"testing"
)

func TestShotAssignmentsOneThroughTwentyAreDistinct(t *testing.T) {
	for count := 1; count <= 20; count++ {
		for _, kind := range []string{"detail", "set", "main", "white", "scene"} {
			shots := ShotAssignments(count, kind, "pet 猫玩具")
			seen := map[string]bool{}
			if len(shots) != count {
				t.Fatalf("%s/%d got %d", kind, count, len(shots))
			}
			for _, shot := range shots {
				camera := strings.Split(strings.Split(shot, "独立机位：")[1], "，相机")[0]
				if seen[camera] {
					t.Fatalf("%s/%d repeats camera %s", kind, count, camera)
				}
				seen[camera] = true
				if !strings.Contains(shot, "不虚构") || !strings.Contains(shot, "平台硬规则优先") {
					t.Fatal("missing factual/platform boundary")
				}
			}
		}
	}
	if !strings.Contains(ShotAssignments(1, "detail", "pet")[0], "单屏完成") {
		t.Fatal("single-page plan must be self-contained")
	}
	scenes := map[string]bool{}
	for _, shot := range ShotAssignments(5, "set", "pet") {
		scenes[strings.Split(strings.Split(shot, "场景创意：")[1], "；")[0]] = true
	}
	if len(scenes) != 5 {
		t.Fatal("five-image set must not sample the same scene repeatedly")
	}
}
