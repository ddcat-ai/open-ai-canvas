package app

import "testing"

func TestResourceIDFromFileURL(t *testing.T) {
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
		if got := resourceIDFromFileURL(item.in); got != item.want {
			t.Fatalf("resourceIDFromFileURL(%q) = %q, want %q", item.in, got, item.want)
		}
	}
}
