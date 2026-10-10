//go:build !windows

package platform

import (
	"errors"
	"syscall"
)

// processAlive 用信号 0 探测进程存在性：ESRCH 表示已消失，EPERM 表示存在但不属于当前用户。
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}
