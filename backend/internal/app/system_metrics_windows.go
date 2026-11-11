//go:build windows

package app

import (
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	systemMetricsKernel32 = windows.NewLazySystemDLL("kernel32.dll")
	systemMemoryStatus    = systemMetricsKernel32.NewProc("GlobalMemoryStatusEx")
	systemCPUTimes        = systemMetricsKernel32.NewProc("GetSystemTimes")
	systemCPUGroupCount   = systemMetricsKernel32.NewProc("GetActiveProcessorGroupCount")
)

func platformMemory() (uint64, uint64, bool) {
	var status struct {
		Length, MemoryLoad                                 uint32
		TotalPhys, AvailPhys, TotalPageFile, AvailPageFile uint64
		TotalVirtual, AvailVirtual, AvailExtendedVirtual   uint64
	}
	status.Length = uint32(unsafe.Sizeof(status))
	if err := systemMemoryStatus.Find(); err != nil {
		return 0, 0, false
	}
	ok, _, _ := systemMemoryStatus.Call(uintptr(unsafe.Pointer(&status)))
	return status.TotalPhys, status.AvailPhys, ok != 0 && status.TotalPhys > 0 && status.AvailPhys <= status.TotalPhys
}

func platformCPUTime() (uint64, uint64, bool) {
	// GetSystemTimes 只覆盖调用线程的处理器组，不能用单组计数冒充整机。
	if err := systemCPUGroupCount.Find(); err != nil {
		return 0, 0, false
	}
	groups, _, _ := systemCPUGroupCount.Call()
	if groups != 1 {
		return 0, 0, false
	}
	if err := systemCPUTimes.Find(); err != nil {
		return 0, 0, false
	}
	var idle, kernel, user windows.Filetime
	ok, _, _ := systemCPUTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user)))
	if ok == 0 {
		return 0, 0, false
	}
	idleTime := uint64(idle.HighDateTime)<<32 | uint64(idle.LowDateTime)
	kernelTime := uint64(kernel.HighDateTime)<<32 | uint64(kernel.LowDateTime)
	userTime := uint64(user.HighDateTime)<<32 | uint64(user.LowDateTime)
	// GetSystemTimes 的 kernel 已包含 idle；FILETIME 在这里是累计时长而非日期。
	return kernelTime + userTime, idleTime, true
}

func platformLoadAverage() ([3]float64, bool) { return [3]float64{}, false }

func collectSystemDisk(path string) SystemPerformanceDisk {
	if path == "" {
		path = "."
	}
	path, _ = filepath.Abs(path)
	directory, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return SystemPerformanceDisk{}
	}

	var free, total, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(directory, &free, &total, &totalFree); err != nil {
		return SystemPerformanceDisk{}
	}

	usage := float64(0)
	if total > 0 {
		usage = float64(total-totalFree) / float64(total) * 100
	}
	return SystemPerformanceDisk{
		Available:    true,
		Writable:     true,
		TotalBytes:   total,
		UsedBytes:    total - totalFree,
		FreeBytes:    free,
		UsagePercent: usage,
	}
}
