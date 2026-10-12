package database

import (
	"net"
	"os"
	"strconv"
	"sync"
	"syscall"
	"testing"
)

// clientSocketKeepalive 在当前进程中按端口找到客户端 socket，读取其 keepalive 选项。
func clientSocketKeepalive(port int) ([4]int, bool) {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return [4]int{}, false
	}
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		addr, err := syscall.Getsockname(fd)
		inet, ok := addr.(*syscall.SockaddrInet4)
		if err != nil || !ok || inet.Port != port {
			continue
		}
		var values [4]int
		for i, option := range [][2]int{
			{syscall.SOL_SOCKET, syscall.SO_KEEPALIVE},
			{syscall.IPPROTO_TCP, syscall.TCP_KEEPIDLE},
			{syscall.IPPROTO_TCP, syscall.TCP_KEEPINTVL},
			{syscall.IPPROTO_TCP, syscall.TCP_KEEPCNT},
		} {
			if values[i], err = syscall.GetsockoptInt(fd, option[0], option[1]); err != nil {
				return [4]int{}, false
			}
		}
		return values, true
	}
	return [4]int{}, false
}

func TestPostgresOpenAppliesLibpqKeepaliveToSocket(t *testing.T) {
	for _, tc := range []struct {
		name, params string
		want         [4]int
	}{
		{"explicit", "keepalives_idle=90 keepalives_interval=20 keepalives_count=6", [4]int{1, 90, 20, 6}},
		{"partial keeps Go defaults", "keepalives_idle=45", [4]int{1, 45, 15, 9}},
		{"no params keeps Go defaults", "", [4]int{1, 15, 15, 9}},
		{"disabled", "keepalives=0", [4]int{0, -1, -1, -1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := newFakePostgresServer(t)
			var mu sync.Mutex
			var observed [][4]int
			server.onStartup = func(conn net.Conn) {
				// 已收到启动消息，说明客户端拨号已完成且 socket 选项已设置。
				values, ok := clientSocketKeepalive(conn.RemoteAddr().(*net.TCPAddr).Port)
				if !ok {
					values = [4]int{-2, -2, -2, -2}
				}
				mu.Lock()
				observed = append(observed, values)
				mu.Unlock()
			}
			openFakePostgres(t, server, tc.params, 0)
			mu.Lock()
			defer mu.Unlock()
			for _, values := range observed {
				if values[0] == -2 {
					t.Fatal("client socket not found")
				}
				if values[0] != tc.want[0] || (tc.want[0] == 1 && values != tc.want) {
					t.Fatalf("keepalive (enabled, idle, interval, count) = %v, want %v", values, tc.want)
				}
			}
		})
	}
}
