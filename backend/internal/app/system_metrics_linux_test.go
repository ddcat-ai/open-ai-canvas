package app

import "testing"

func TestParseLinuxCPUTime(t *testing.T) {
	for _, test := range []struct {
		name, data  string
		total, idle uint64
		ok          bool
	}{
		{"all counters without double counting guests", "cpu 100 20 30 400 50 6 7 8 60 10\ncpu0 1 2 3 4", 621, 450, true},
		{"four required counters", "cpu 1 2 3 4\n", 10, 4, true},
		{"not aggregate cpu", "cpu0 1 2 3 4", 0, 0, false},
		{"missing idle", "cpu 1 2 3", 0, 0, false},
		{"invalid counter", "cpu 1 bad 3 4", 0, 0, false},
		{"negative counter", "cpu 1 2 3 4 -1", 0, 0, false},
		{"overflow", "cpu 18446744073709551615 1 0 0", 0, 0, false},
		{"empty", "", 0, 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			total, idle, ok := parseLinuxCPUTime(test.data)
			if total != test.total || idle != test.idle || ok != test.ok {
				t.Fatalf("parseLinuxCPUTime() = (%d, %d, %v), want (%d, %d, %v)", total, idle, ok, test.total, test.idle, test.ok)
			}
		})
	}
}
