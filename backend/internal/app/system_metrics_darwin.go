//go:build darwin

package app

import "golang.org/x/sys/unix"

func platformMemory() (uint64, uint64, bool) {
	total, err := unix.SysctlUint64("hw.memsize")
	if err != nil || total == 0 {
		return 0, 0, false
	}
	// hw.memsize 只能稳定提供物理内存总量；没有可靠可用量时不要把 available=0
	// 误算成 100% 占用，页面会明确降级展示 Go 进程堆内存。
	return total, 0, false
}

func platformLoadAverage() ([3]float64, bool) {
	return [3]float64{}, false
}
