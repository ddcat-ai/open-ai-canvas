package payment

// RPCProvider is the host side of the yingce.payment/v1 process ABI. The
// process is shipped inside a validated plugin package and receives exactly
// one JSON request on stdin, returning one JSON response on stdout. The host
// still owns the order, credential storage, network policy and crediting
// transaction; the process only translates a payment provider protocol.

import (
	"bytes"
	"context"
	"debug/elf"
	"debug/macho"
	"debug/pe"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

const (
	pluginRPCVersion   = "yingce.payment/v1"
	pluginRPCMaxOutput = 2 << 20
	pluginRPCTimeout   = 30 * time.Second
)

type RPCProvider struct {
	descriptor Descriptor
	entry      string
	command    string
	dir        string
}

func NewRPCProvider(descriptor Descriptor, packageDir, entry string) (*RPCProvider, error) {
	if strings.TrimSpace(descriptor.ID) == "" || strings.TrimSpace(descriptor.PluginID) == "" {
		return nil, errors.New("payment plugin descriptor requires id and plugin id")
	}
	if filepath.IsAbs(entry) || path.Clean(entry) != entry || !strings.HasPrefix(entry, "backend/") {
		return nil, errors.New("payment plugin entry must be relative to backend/")
	}
	if strings.TrimSpace(packageDir) == "" {
		return nil, errors.New("payment plugin package directory is empty")
	}
	packageDir, err := filepath.Abs(packageDir)
	if err != nil {
		return nil, fmt.Errorf("payment plugin package directory is invalid: %w", err)
	}
	return &RPCProvider{descriptor: descriptor, entry: entry, dir: packageDir}, nil
}

func (p *RPCProvider) Descriptor() Descriptor { return p.descriptor }

type rpcRequest struct {
	Version   string              `json:"version"`
	Operation string              `json:"operation"`
	Config    Config              `json:"config,omitempty"`
	Request   any                 `json:"request,omitempty"`
	Headers   map[string][]string `json:"headers,omitempty"`
	Body      string              `json:"bodyBase64,omitempty"`
	BillDate  string              `json:"billDate,omitempty"`
}

type rpcResponse struct {
	OK      bool            `json:"ok"`
	Error   string          `json:"error,omitempty"`
	Code    string          `json:"code,omitempty"`
	Message string          `json:"message,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (p *RPCProvider) call(ctx context.Context, request rpcRequest, output any) error {
	if p == nil {
		return errors.New("payment plugin runtime is unavailable")
	}
	command, err := p.executable()
	if err != nil {
		return p.startError(err)
	}
	info, err := os.Stat(command)
	if err != nil {
		return p.startError(err)
	}
	if info.IsDir() {
		return p.startError(fmt.Errorf("payment plugin executable is a directory: %w", syscall.EACCES))
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return p.startError(fmt.Errorf("payment plugin executable has no execute bit: %w", syscall.EACCES))
	}
	if err := validatePaymentExecutablePlatform(command); err != nil {
		return p.startError(err)
	}
	ctx, cancel := context.WithTimeout(ctx, pluginRPCTimeout)
	defer cancel()
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, command)
	cmd.Dir = p.dir
	cmd.Env = paymentPluginCommandEnv()
	cmd.Stdin = strings.NewReader(string(payload) + "\n")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return p.startError(err)
	}
	data, readErr := io.ReadAll(io.LimitReader(stdout, pluginRPCMaxOutput+1))
	_, _ = io.ReadAll(io.LimitReader(stderr, 64<<10))
	waitErr := cmd.Wait()
	if readErr != nil {
		return &ProviderError{Code: "plugin_read_failed", Message: "读取支付插件响应失败", Temporary: true, Cause: readErr}
	}
	if len(data) > pluginRPCMaxOutput {
		return errors.New("支付插件响应超过安全限制")
	}
	if ctx.Err() != nil {
		return &ProviderError{Code: "plugin_timeout", Message: "支付插件执行超时", Temporary: true, Cause: ctx.Err()}
	}
	if waitErr != nil {
		return &ProviderError{Code: "plugin_process_failed", Message: "支付插件进程异常退出", Temporary: true, Cause: waitErr}
	}
	var response rpcResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return &ProviderError{Code: "plugin_invalid_response", Message: "支付插件返回了无效响应", Temporary: true, Cause: err}
	}
	if !response.OK {
		message := response.Message
		if message == "" {
			message = response.Error
		}
		if message == "" {
			message = "支付插件返回失败"
		}
		return &ProviderError{Code: response.Code, Message: message}
	}
	if output == nil || len(response.Data) == 0 {
		return nil
	}
	if err := json.Unmarshal(response.Data, output); err != nil {
		return fmt.Errorf("解析支付插件数据失败：%w", err)
	}
	return nil
}

func (p *RPCProvider) executable() (string, error) {
	if p == nil {
		return "", errors.New("payment plugin runtime is unavailable")
	}
	if strings.TrimSpace(p.command) != "" {
		return p.command, nil
	}
	command, err := ResolveRPCBackendPath(p.dir, p.entry)
	if err != nil {
		return "", err
	}
	command, err = filepath.Abs(command)
	if err != nil {
		return "", err
	}
	p.command = command
	return command, nil
}

func (p *RPCProvider) startError(cause error) error {
	providerErr := classifyPaymentPluginStartError(cause)
	command := strings.TrimSpace(p.command)
	if command == "" {
		command, _ = ResolveRPCBackendPath(p.dir, p.entry)
	}
	log.Printf(
		"payment plugin executable failed: provider=%q plugin=%q host=%s/%s command=%q code=%s error=%v",
		p.descriptor.ID,
		p.descriptor.PluginID,
		runtime.GOOS,
		runtime.GOARCH,
		command,
		providerErr.Code,
		cause,
	)
	return providerErr
}

func paymentPluginCommandEnv() []string {
	if runtime.GOOS == "windows" {
		systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
		if systemRoot == "" {
			systemRoot = strings.TrimSpace(os.Getenv("SYSTEMROOT"))
		}
		env := []string{"HOME=" + filepath.Join("C:\\", "nonexistent")}
		if systemRoot != "" {
			env = append(env, "SystemRoot="+systemRoot, "SYSTEMROOT="+systemRoot)
		}
		return env
	}
	return []string{"PATH=/usr/bin:/bin", "HOME=/nonexistent"}
}

func ResolveRPCBackendPath(packageDir, entry string) (string, error) {
	if strings.TrimSpace(packageDir) == "" {
		return "", fmt.Errorf("payment plugin executable for %s/%s is missing: %w", runtime.GOOS, runtime.GOARCH, os.ErrNotExist)
	}
	var missingErr, formatErr error
	for _, candidate := range protocol.PaymentRPCBackendCandidates(entry, runtime.GOOS, runtime.GOARCH) {
		target := filepath.Join(packageDir, filepath.FromSlash(candidate))
		info, err := os.Stat(target)
		if err != nil {
			if missingErr == nil {
				missingErr = err
			}
			continue
		}
		if info.IsDir() {
			if missingErr == nil {
				missingErr = os.ErrNotExist
			}
			continue
		}
		if err := validatePaymentExecutablePlatform(target); err != nil {
			if formatErr == nil {
				formatErr = err
			}
			continue
		}
		return target, nil
	}
	if formatErr != nil {
		return "", fmt.Errorf("payment plugin executable for %s/%s is incompatible: %w", runtime.GOOS, runtime.GOARCH, formatErr)
	}
	if missingErr == nil {
		missingErr = os.ErrNotExist
	}
	return "", fmt.Errorf("payment plugin executable for %s/%s is missing: %w", runtime.GOOS, runtime.GOARCH, missingErr)
}

func classifyPaymentPluginStartError(cause error) *ProviderError {
	switch {
	case errors.Is(cause, os.ErrNotExist), errors.Is(cause, syscall.ENOENT), errors.Is(cause, exec.ErrNotFound):
		return &ProviderError{Code: "plugin_executable_missing", Message: "支付插件可执行文件或其运行时加载器不可用", Cause: cause}
	case errors.Is(cause, os.ErrPermission), errors.Is(cause, syscall.EACCES):
		return &ProviderError{Code: "plugin_permission_denied", Message: "支付插件没有执行权限", Cause: cause}
	case errors.Is(cause, syscall.ENOEXEC):
		return &ProviderError{Code: "plugin_exec_format_error", Message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容", Cause: cause}
	default:
		return &ProviderError{Code: "plugin_start_failed", Message: "支付插件启动失败", Temporary: true, Cause: cause}
	}
}

func validatePaymentExecutablePlatform(command string) error {
	file, err := os.Open(command)
	if err != nil {
		return err
	}
	defer file.Close()

	var magic [4]byte
	if _, err := io.ReadFull(file, magic[:]); err != nil {
		return fmt.Errorf("payment plugin executable header is incomplete: %w", syscall.ENOEXEC)
	}

	switch runtime.GOOS {
	case "linux":
		if bytes.Equal(magic[:2], []byte{'M', 'Z'}) {
			return fmt.Errorf("payment plugin executable is Windows PE on linux/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if isMachOMagic(magic) {
			return fmt.Errorf("payment plugin executable is Mach-O on linux/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if !bytes.Equal(magic[:], []byte{0x7f, 'E', 'L', 'F'}) {
			return nil
		}
		binary, err := elf.NewFile(file)
		if err != nil {
			return fmt.Errorf("payment plugin ELF header is invalid: %w", syscall.ENOEXEC)
		}
		defer binary.Close()
		expected, ok := expectedPaymentELFMachine(runtime.GOARCH)
		if binary.Class != elf.ELFCLASS64 || (ok && binary.Machine != expected) {
			return fmt.Errorf("payment plugin ELF architecture mismatch: host=linux/%s class=%s machine=%s: %w", runtime.GOARCH, binary.Class, binary.Machine, syscall.ENOEXEC)
		}
		return nil
	case "darwin":
		if bytes.Equal(magic[:], []byte{0x7f, 'E', 'L', 'F'}) {
			return fmt.Errorf("payment plugin executable is ELF on darwin/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if bytes.Equal(magic[:2], []byte{'M', 'Z'}) {
			return fmt.Errorf("payment plugin executable is Windows PE on darwin/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if !isMachOMagic(magic) {
			return nil
		}
		return validateMachOArchitecture(command)
	case "windows":
		if bytes.Equal(magic[:], []byte{0x7f, 'E', 'L', 'F'}) {
			return fmt.Errorf("payment plugin executable is ELF on windows/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if isMachOMagic(magic) {
			return fmt.Errorf("payment plugin executable is Mach-O on windows/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
		}
		if !bytes.Equal(magic[:2], []byte{'M', 'Z'}) {
			return nil
		}
		return validateWindowsPEArchitecture(command)
	default:
		return nil
	}
}

func validateMachOArchitecture(command string) error {
	expected, ok := expectedMachOCPU(runtime.GOARCH)
	file, err := macho.Open(command)
	if err == nil {
		defer file.Close()
		if ok && file.Cpu != expected {
			return fmt.Errorf("payment plugin Mach-O architecture mismatch: host=darwin/%s cpu=%s: %w", runtime.GOARCH, file.Cpu, syscall.ENOEXEC)
		}
		return nil
	}
	fat, fatErr := macho.OpenFat(command)
	if fatErr != nil {
		return fmt.Errorf("payment plugin Mach-O header is invalid: %w", syscall.ENOEXEC)
	}
	defer fat.Close()
	if !ok {
		return nil
	}
	for _, arch := range fat.Arches {
		if arch.Cpu == expected {
			return nil
		}
	}
	return fmt.Errorf("payment plugin Mach-O architecture mismatch: host=darwin/%s: %w", runtime.GOARCH, syscall.ENOEXEC)
}

func validateWindowsPEArchitecture(command string) error {
	file, err := pe.Open(command)
	if err != nil {
		return fmt.Errorf("payment plugin PE header is invalid: %w", syscall.ENOEXEC)
	}
	defer file.Close()
	expected, ok := expectedPEMachine(runtime.GOARCH)
	if ok && file.Machine != expected {
		return fmt.Errorf("payment plugin PE architecture mismatch: host=windows/%s machine=%d: %w", runtime.GOARCH, file.Machine, syscall.ENOEXEC)
	}
	return nil
}

func isMachOMagic(magic [4]byte) bool {
	return magic == [4]byte{0xfe, 0xed, 0xfa, 0xce} ||
		magic == [4]byte{0xce, 0xfa, 0xed, 0xfe} ||
		magic == [4]byte{0xfe, 0xed, 0xfa, 0xcf} ||
		magic == [4]byte{0xcf, 0xfa, 0xed, 0xfe}
}

func expectedPaymentELFMachine(arch string) (elf.Machine, bool) {
	switch arch {
	case "amd64":
		return elf.EM_X86_64, true
	case "arm64":
		return elf.EM_AARCH64, true
	default:
		return elf.EM_NONE, false
	}
}

func expectedMachOCPU(arch string) (macho.Cpu, bool) {
	switch arch {
	case "amd64":
		return macho.CpuAmd64, true
	case "arm64":
		return macho.CpuArm64, true
	default:
		return 0, false
	}
}

func expectedPEMachine(arch string) (uint16, bool) {
	switch arch {
	case "amd64":
		return pe.IMAGE_FILE_MACHINE_AMD64, true
	case "arm64":
		return pe.IMAGE_FILE_MACHINE_ARM64, true
	default:
		return 0, false
	}
}

func (p *RPCProvider) ValidateConfig(config Config) error {
	return p.call(context.Background(), rpcRequest{Version: pluginRPCVersion, Operation: "validate_config", Config: config}, nil)
}

func (p *RPCProvider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	var result Checkout
	err := p.call(ctx, rpcRequest{Version: pluginRPCVersion, Operation: "create_order", Config: config, Request: request}, &result)
	return result, err
}

func (p *RPCProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	var result Result
	err := p.call(ctx, rpcRequest{Version: pluginRPCVersion, Operation: "query_order", Config: config, Request: request}, &result)
	return result, err
}

func (p *RPCProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	var result Result
	err := p.call(ctx, rpcRequest{Version: pluginRPCVersion, Operation: "close_order", Config: config, Request: request}, &result)
	return result, err
}

func (p *RPCProvider) VerifyNotification(ctx context.Context, config Config, headers http.Header, rawBody []byte) (Notification, error) {
	var result Notification
	headerValues := map[string][]string(headers)
	err := p.call(ctx, rpcRequest{Version: pluginRPCVersion, Operation: "verify_notification", Config: config, Headers: headerValues, Body: base64.StdEncoding.EncodeToString(rawBody)}, &result)
	return result, err
}

func (p *RPCProvider) DownloadTradeBill(ctx context.Context, config Config, billDate time.Time) ([]BillRecord, error) {
	var result []BillRecord
	err := p.call(ctx, rpcRequest{Version: pluginRPCVersion, Operation: "download_trade_bill", Config: config, BillDate: billDate.Format("2006-01-02")}, &result)
	return result, err
}
