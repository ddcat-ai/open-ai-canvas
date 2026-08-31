//go:build !windows

package hostupdate

import (
	"fmt"
	"syscall"
)

// checkBackupDiskSpace 确保备份目录至少有 2 GiB 可用空间。
func checkBackupDiskSpace(directory string) error {
	var disk syscall.Statfs_t
	if err := syscall.Statfs(directory, &disk); err != nil {
		return fmt.Errorf("检查备份磁盘空间：%w", err)
	}
	available := int64(disk.Bavail) * int64(disk.Bsize)
	if available < 2<<30 {
		return fmt.Errorf("备份目录可用空间不足 2 GiB：当前 %d MiB", available>>20)
	}
	return nil
}
