package database

import (
	"context"
	"fmt"
	"maps"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// defaultIdleInTransactionSessionTimeout 限制事务内等待下一条命令的时间，
// 避免卡住的 idle in transaction 会话长期持有锁。DSN 显式配置时以 DSN 为准。
const defaultIdleInTransactionSessionTimeout = "5min"

var libpqKeepaliveParams = []string{"keepalives", "keepalives_idle", "keepalives_interval", "keepalives_count"}

// configurePostgresConnection 在每次建立物理连接前调整 pgx 连接配置。
func configurePostgresConnection(_ context.Context, config *pgx.ConnConfig) error {
	// stdlib 传入的是浅拷贝，RuntimeParams 与连接器共享，修改前必须复制，否则会跨连接累积。
	config.RuntimeParams = maps.Clone(config.RuntimeParams)
	if config.RuntimeParams == nil {
		config.RuntimeParams = make(map[string]string)
	}
	if err := applyLibpqKeepalives(config); err != nil {
		return err
	}
	if _, exists := config.RuntimeParams["idle_in_transaction_session_timeout"]; !exists {
		// PostgreSQL 按顺序处理 options，DSN 原有 options 放在后面，同名设置以 DSN 为准。
		options := "-c idle_in_transaction_session_timeout=" + defaultIdleInTransactionSessionTimeout
		if existing := strings.TrimSpace(config.RuntimeParams["options"]); existing != "" {
			options += " " + existing
		}
		config.RuntimeParams["options"] = options
	}
	return nil
}

// applyLibpqKeepalives 消费 libpq 的 keepalives* 参数并应用到 TCP 拨号器。
// pgx 不识别这些参数，会把它们当作服务端运行参数发送，导致 PostgreSQL 拒绝连接。
// 未配置任何 keepalives* 参数时保持 pgx 默认拨号器（Go 默认 keepalive）不变。
func applyLibpqKeepalives(config *pgx.ConnConfig) error {
	values := make(map[string]int)
	for _, key := range libpqKeepaliveParams {
		raw, ok := config.RuntimeParams[key]
		if !ok {
			continue
		}
		delete(config.RuntimeParams, key)
		value, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || value < 0 || (key == "keepalives" && value > 1) {
			return fmt.Errorf("invalid PostgreSQL connection parameter %s=%q", key, raw)
		}
		values[key] = value
	}
	if len(values) == 0 {
		return nil
	}
	dialer := &net.Dialer{Timeout: config.ConnectTimeout}
	if enabled, ok := values["keepalives"]; ok && enabled == 0 {
		dialer.KeepAlive = -1
	} else {
		// 未配置的项使用 Go 默认值（0）；libpq 的 0 表示操作系统默认值，对应 Go 的 -1。
		setting := func(key string) int {
			value, ok := values[key]
			if !ok {
				return 0
			}
			if value == 0 {
				return -1
			}
			return value
		}
		dialer.KeepAliveConfig = net.KeepAliveConfig{
			Enable:   true,
			Idle:     time.Duration(setting("keepalives_idle")) * time.Second,
			Interval: time.Duration(setting("keepalives_interval")) * time.Second,
			Count:    setting("keepalives_count"),
		}
	}
	config.DialFunc = dialer.DialContext
	return nil
}
