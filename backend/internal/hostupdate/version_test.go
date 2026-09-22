package hostupdate

import "testing"

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		left, right string
		want        int
	}{
		{"v1.2.0-preview.2", "v1.2.0-preview.3", -1},
		{"v1.2.0-preview.10", "v1.2.0-preview.3", 1},
		{"v1.2.0-preview.3", "v1.2.0", -1},
		{"v1.2.1", "v1.2.0", 1},
		{"v1.5.7.1", "v1.5.7", 1},
		{"v1.5.7.1", "v1.5.7.2", -1},
		{"v1.2.0", "v1.2.0", 0},
		{"vsha-5509b17", "v1.5.0", -1},
		{"sha-5509b17", "v1.5.0", -1},
		{"v1.5.0", "vsha-5509b17", 1},
		{"v1.2.9", "v1.5.0", -1},
	}
	for _, test := range tests {
		got := CompareVersions(test.left, test.right)
		if got < 0 {
			got = -1
		} else if got > 0 {
			got = 1
		}
		if got != test.want {
			t.Fatalf("CompareVersions(%q, %q)=%d, want %d", test.left, test.right, got, test.want)
		}
	}
}
