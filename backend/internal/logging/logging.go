// Package logging 是后端唯一的日志出口。
//
// slog、标准库 log、GORM 与 Gin 访问日志都经由同一个 slog Handler 输出，格式与级别由环境变量统一控制：
//
//	CANVAS_LOG_LEVEL         debug | info | warn | error（默认 info）
//	CANVAS_LOG_FORMAT        text | json（默认 text）
//	CANVAS_LOG_SLOW_REQUEST  API 慢请求阈值（默认 2s，0 关闭）
//	CANVAS_LOG_SLOW_SQL      慢 SQL 阈值（默认 500ms，0 关闭）
//
// 约定：新代码直接使用 log/slog 并选择合适级别；查询、流式事件、轮询等高频路径只能用 Debug。
// 存量 log.Printf 基本都在失败分支，Setup 后统一按 WARN 桥接进同一个 Handler。
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	EnvLevel       = "CANVAS_LOG_LEVEL"
	EnvFormat      = "CANVAS_LOG_FORMAT"
	EnvSlowRequest = "CANVAS_LOG_SLOW_REQUEST"
	EnvSlowSQL     = "CANVAS_LOG_SLOW_SQL"

	defaultSlowRequest = 2 * time.Second
	defaultSlowSQL     = 500 * time.Millisecond
)

type Config struct {
	Level       slog.Level
	JSON        bool
	SlowRequest time.Duration
	SlowSQL     time.Duration
	Output      io.Writer
}

var (
	level = new(slog.LevelVar)

	settingsMu  sync.RWMutex
	slowRequest = defaultSlowRequest
	slowSQL     = defaultSlowSQL
)

// ConfigFromEnv 读取日志环境变量；非法取值直接报错，避免线上悄悄退回到噪声更大的配置。
func ConfigFromEnv() (Config, error) {
	config := Config{Level: slog.LevelInfo, SlowRequest: defaultSlowRequest, SlowSQL: defaultSlowSQL}
	if raw := strings.TrimSpace(os.Getenv(EnvLevel)); raw != "" {
		parsed, err := ParseLevel(raw)
		if err != nil {
			return Config{}, err
		}
		config.Level = parsed
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv(EnvFormat))) {
	case "", "text":
	case "json":
		config.JSON = true
	default:
		return Config{}, fmt.Errorf("%s 只能是 text 或 json", EnvFormat)
	}
	var err error
	if config.SlowRequest, err = envThreshold(EnvSlowRequest, defaultSlowRequest); err != nil {
		return Config{}, err
	}
	if config.SlowSQL, err = envThreshold(EnvSlowSQL, defaultSlowSQL); err != nil {
		return Config{}, err
	}
	return config, nil
}

func ParseLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("%s 只能是 debug、info、warn 或 error", EnvLevel)
	}
}

func envThreshold(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	if raw == "0" {
		return 0, nil
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s 必须是非负时长，例如 2s；0 表示关闭", key)
	}
	return parsed, nil
}

// Setup 安装全局日志 Handler，必须在打开数据库、创建路由之前调用。
func Setup(config Config) {
	output := config.Output
	if output == nil {
		output = os.Stderr
	}
	level.Set(config.Level)
	settingsMu.Lock()
	slowRequest, slowSQL = config.SlowRequest, config.SlowSQL
	settingsMu.Unlock()

	options := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if config.JSON {
		handler = slog.NewJSONHandler(output, options)
	} else {
		handler = slog.NewTextHandler(output, options)
	}
	slog.SetDefault(slog.New(handler))
	// SetDefault 之后标准库 log 也写入同一个 Handler；存量调用基本都是失败分支，按 WARN 输出。
	slog.SetLogLoggerLevel(slog.LevelWarn)
}

// SetLevel 允许运行时调整级别（例如临时打开 debug 排障）。
func SetLevel(value slog.Level) { level.Set(value) }

func DebugEnabled() bool { return level.Level() <= slog.LevelDebug }

func slowRequestThreshold() time.Duration {
	settingsMu.RLock()
	defer settingsMu.RUnlock()
	return slowRequest
}

func slowSQLThreshold() time.Duration {
	settingsMu.RLock()
	defer settingsMu.RUnlock()
	return slowSQL
}

var sampled sync.Map // key -> 上次放行时间

// Every 让同一个 key 在 interval 内只放行一次，用于读路径上会随请求重复出现的告警。
// key 必须来自有限集合（例如模型 ID），不能带请求级别的随机值，否则会无限增长。
func Every(key string, interval time.Duration) bool {
	now := time.Now()
	for {
		previous, loaded := sampled.LoadOrStore(key, now)
		if !loaded {
			return true
		}
		if now.Sub(previous.(time.Time)) < interval {
			return false
		}
		if sampled.CompareAndSwap(key, previous, now) {
			return true
		}
	}
}
