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
		// 带字母前缀的序号必须按数值比较：字典序会把 r10 判成小于 r9，
		// 导致 r10 之后的版本在更新页面永远不可见。
		{"v1.6.8.13-topapis-r10", "v1.6.8.13-topapis-r9", 1},
		{"v1.6.8.13-topapis-r9", "v1.6.8.13-topapis-r10", -1},
		{"v1.6.8.13-topapis-r10", "v1.6.8.13-topapis-r10", 0},
		{"v1.6.8.13-topapis-r100", "v1.6.8.13-topapis-r99", 1},
		{"v1.6.8.13-topapis-r2", "v1.6.8.13-topapis-r10", -1},
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
