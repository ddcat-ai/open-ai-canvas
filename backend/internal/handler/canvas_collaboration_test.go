package handler

import (
	"net/http/httptest"
	"testing"
)

func TestCanvasCollaborationOrigin(t *testing.T) {
	for _, tc := range []struct {
		origin, allowed string
		want            bool
	}{
		{"http://canvas.test", "", true},
		{"https://frontend.test", "https://frontend.test", true},
		{"https://evil.test", "", false},
		{"ftp://canvas.test", "ftp://canvas.test", false},
		{"http://user@canvas.test", "", false},
		{"null", "", false},
	} {
		t.Run(tc.origin, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://canvas.test/api/canvas-projects/c/collaboration/ws", nil)
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-Forwarded-Host", "evil.test")
			req.Header.Set("X-Forwarded-Proto", "https")
			if got := canvasCollaborationCheckOrigin(req, tc.allowed); got != tc.want {
				t.Fatalf("allowed = %t, want %t", got, tc.want)
			}
		})
	}
}
