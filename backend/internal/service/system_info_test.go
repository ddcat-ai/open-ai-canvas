package service

import "testing"

func TestSystemInfoHelpers(t *testing.T) {
	if got := roundTo(12.345, 2); got != 12.35 {
		t.Fatalf("roundTo() = %v, want 12.35", got)
	}
	if got := trimTo("abcdef", 4); got != "abcd" {
		t.Fatalf("trimTo() = %q, want abcd", got)
	}
	if got := pickNonEmpty("", "  ", "canvas"); got != "canvas" {
		t.Fatalf("pickNonEmpty() = %q, want canvas", got)
	}
}

func TestCollectSystemInstancesReturnsAdminSafeSnapshot(t *testing.T) {
	instances := CollectSystemInstances("abcdef123", "test")
	if len(instances) != 1 {
		t.Fatalf("instances = %d, want one instance", len(instances))
	}
	instance := instances[0]
	if !instance.Online || instance.Status != "online" || instance.Role != "master" {
		t.Fatalf("instance status = %+v, want online master", instance)
	}
	if instance.Version != "abcdef1 · test" {
		t.Fatalf("version = %q, want abbreviated commit and build time", instance.Version)
	}
}
