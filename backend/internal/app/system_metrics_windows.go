//go:build windows

package app

import (
	"path/filepath"

	"golang.org/x/sys/windows"
)

func platformMemory() (uint64, uint64, bool) { return 0, 0, false }

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
