//go:build linux || darwin

package app

import (
	"os"
	"path/filepath"
	"syscall"
)

func collectSystemDisk(path string) SystemPerformanceDisk {
	if path == "" {
		path = "."
	}
	path, _ = filepath.Abs(path)
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return SystemPerformanceDisk{}
	}
	blockSize := uint64(stats.Bsize)
	total := stats.Blocks * blockSize
	free := stats.Bavail * blockSize
	used := total - stats.Bfree*blockSize
	usage := float64(0)
	if total > 0 {
		usage = float64(used) / float64(total) * 100
	}
	writable := false
	if file, err := os.CreateTemp(path, ".system-performance-write-check-"); err == nil {
		writable = true
		name := file.Name()
		_ = file.Close()
		_ = os.Remove(name)
	}
	return SystemPerformanceDisk{Available: true, Writable: writable, TotalBytes: total, UsedBytes: used, FreeBytes: free, UsagePercent: usage}
}
