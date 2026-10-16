//go:build windows

package platform

import (
	"errors"
	"syscall"
)

// processAlive 用进程句柄探测存活状态：父进程退出后句柄进入有信号状态，
// 比查退出码更直接，也不受父进程何时被回收影响。
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := syscall.OpenProcess(syscall.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		// 权限不足只说明拿不到句柄，进程仍然存在。
		return errors.Is(err, syscall.ERROR_ACCESS_DENIED)
	}
	defer syscall.CloseHandle(handle)
	status, err := syscall.WaitForSingleObject(handle, 0)
	if err != nil {
		return true
	}
	return status == uint32(syscall.WAIT_TIMEOUT)
}
