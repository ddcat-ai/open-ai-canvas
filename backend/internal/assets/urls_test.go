package assets

import "testing"

func TestIDFromFileURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"/api/resources/abc_123/file", "abc_123"},
		{"https://host.example/api/resources/abc_123/file?proxy=1", "abc_123"},
		{"/api/projects/abc_123", ""},
		{"", ""},
	}
	for _, item := range cases {
		if got := IDFromFileURL(item.in); got != item.want {
			t.Fatalf("IDFromFileURL(%q) = %q, want %q", item.in, got, item.want)
		}
	}
}

func TestResourceID(t *testing.T) {
	if got := ResourceID("resource:abc_123"); got != "abc_123" {
		t.Fatalf("ResourceID(resource:) = %q", got)
	}
	if got := ResourceID("/api/resources/abc_123/file"); got != "abc_123" {
		t.Fatalf("ResourceID(file url) = %q", got)
	}
	if got := ResourceID("resource:../secret"); got != "" {
		t.Fatalf("ResourceID accepted traversal: %q", got)
	}
}
