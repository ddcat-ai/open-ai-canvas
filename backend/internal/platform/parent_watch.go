package platform

import (
	"context"
	"time"
)

// ParentWatchInterval 是孤儿看门狗的轮询间隔。壳异常退出后本地服务应在秒级释放
// 端口与数据目录，间隔取秒级即可；更密只会白白唤醒进程。
const ParentWatchInterval = time.Second

// WatchParent 周期检查 pid 是否仍存活，进程消失时调用 onExit 并返回；ctx 结束时直接返回。
// 它不保证父进程是被本进程的父进程：调用方传入的 PID 由桌面壳提供。
func WatchParent(ctx context.Context, pid int, interval time.Duration, onExit func()) {
	if pid <= 0 || onExit == nil || interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !processAlive(pid) {
				onExit()
				return
			}
		}
	}
}
