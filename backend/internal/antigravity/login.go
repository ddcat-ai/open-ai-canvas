package antigravity

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// 登录走 agy acp --login 的「打开链接、粘贴授权码」流程：服务器上不需要浏览器，
// 管理员在自己的浏览器里登录 Google，再把 Antigravity 页面显示的授权码贴回后台。
const (
	loginLinkTimeout   = 90 * time.Second
	loginTTL           = 5 * time.Minute
	loginFinishTimeout = 2 * time.Minute
	googleSignInPrefix = "https://accounts.google.com/"
)

type LoginPhase string

const (
	LoginIdle      LoginPhase = "idle"
	LoginWaiting   LoginPhase = "waiting"
	LoginVerifying LoginPhase = "verifying"
	LoginSucceeded LoginPhase = "succeeded"
	LoginFailed    LoginPhase = "failed"
)

// LoginState 是后台登录面板看到的状态。
type LoginState struct {
	Phase            LoginPhase `json:"phase"`
	AuthorizationURL string     `json:"authorizationUrl,omitempty"`
	ExpiresAt        *time.Time `json:"expiresAt,omitempty"`
	Message          string     `json:"message,omitempty"`
}

type loginFlow struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	output  *tailBuffer
	state   LoginState
	exited  chan struct{}
	exitErr error
	timer   *time.Timer
}

func (f *loginFlow) stop() {
	f.timer.Stop()
	_ = f.stdin.Close()
	if f.cmd.Process != nil {
		_ = f.cmd.Process.Kill()
	}
	<-f.exited
}

// StartLogin 启动 agy 登录并返回 Google 登录链接；同一渠道已有登录流程时先结束旧流程。
func (m *Manager) StartLogin(ctx context.Context, profile Profile) (LoginState, error) {
	settings, err := m.Settings(profile.ChannelID)
	if err != nil {
		return LoginState{}, err
	}
	if !settings.Auth.Type.UsesGoogleSignIn() {
		return LoginState{}, errors.New("当前登录方式使用 API Key，不需要登录 Google")
	}
	if err := m.SaveSettingsIfMissing(profile.ChannelID, settings); err != nil {
		return LoginState{}, err
	}
	executable, err := m.executable()
	if err != nil {
		return LoginState{}, err
	}
	m.CancelLogin(profile.ChannelID)
	tempDir := filepath.Join(m.acpDirectory(profile.ChannelID), "tmp")
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return LoginState{}, err
	}
	cmd := exec.Command(executable, "acp", "--gemini-dir", m.profileDirectory(profile.ChannelID), "--app-data-dir", acpDirectoryName, "--login")
	cmd.Env = m.environment(profile, settings, tempDir)
	cmd.Dir = tempDir
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return LoginState{}, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return LoginState{}, err
	}
	output := &tailBuffer{limit: acpStderrTailBytes}
	cmd.Stderr = output
	if err := cmd.Start(); err != nil {
		return LoginState{}, fmt.Errorf("无法启动 Antigravity 登录：%w", err)
	}
	flow := &loginFlow{cmd: cmd, stdin: stdin, output: output, exited: make(chan struct{})}
	links := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			_, _ = output.Write([]byte(line + "\n"))
			if strings.HasPrefix(line, googleSignInPrefix) {
				select {
				case links <- line:
				default:
				}
			}
		}
		flow.exitErr = cmd.Wait()
		close(flow.exited)
	}()
	waitCtx, cancel := context.WithTimeout(ctx, loginLinkTimeout)
	defer cancel()
	select {
	case link := <-links:
		expiresAt := time.Now().UTC().Add(loginTTL)
		flow.state = LoginState{Phase: LoginWaiting, AuthorizationURL: link, ExpiresAt: &expiresAt, Message: "在浏览器里打开链接登录 Google，再把 Antigravity 页面显示的授权码粘贴到这里。"}
		flow.timer = time.AfterFunc(loginTTL, func() { m.expireLogin(profile.ChannelID, flow) })
		m.stateMu.Lock()
		m.logins[profile.ChannelID] = flow
		m.stateMu.Unlock()
		return flow.state, nil
	case <-flow.exited:
		return LoginState{}, fmt.Errorf("Antigravity 登录没有给出登录链接：%s", lastLine(output.String()))
	case <-waitCtx.Done():
		_ = cmd.Process.Kill()
		<-flow.exited
		return LoginState{}, errors.New("Antigravity 90 秒内没有给出登录链接，请检查服务器能否访问 Google")
	}
}

func (m *Manager) expireLogin(channelID string, flow *loginFlow) {
	m.stateMu.Lock()
	current := m.logins[channelID]
	if current == flow && flow.state.Phase == LoginWaiting {
		delete(m.logins, channelID)
	} else {
		current = nil
	}
	m.stateMu.Unlock()
	if current != nil {
		_ = flow.stdin.Close()
		_ = flow.cmd.Process.Kill()
	}
}

// SubmitLoginCode 把授权码（或 Antigravity 回调页面的完整网址）交给 agy，等待登录完成。
func (m *Manager) SubmitLoginCode(ctx context.Context, channelID, code string) (LoginState, error) {
	code = strings.TrimSpace(code)
	if code == "" || strings.ContainsAny(code, "\r\n") {
		return LoginState{}, errors.New("请粘贴 Antigravity 页面显示的授权码，或该页面的完整网址")
	}
	m.stateMu.Lock()
	flow := m.logins[channelID]
	if flow == nil || flow.state.Phase != LoginWaiting {
		m.stateMu.Unlock()
		return LoginState{}, errors.New("登录已过期或已结束，请重新点击登录")
	}
	flow.timer.Stop()
	flow.state = LoginState{Phase: LoginVerifying, Message: "正在等待 Google 完成登录。"}
	m.stateMu.Unlock()
	if _, err := io.WriteString(flow.stdin, code+"\n"); err != nil {
		m.finishLogin(channelID, flow, LoginState{Phase: LoginFailed, Message: "无法把授权码交给 Antigravity，请重新登录"})
		return m.LoginState(channelID), nil
	}
	waitCtx, cancel := context.WithTimeout(ctx, loginFinishTimeout)
	defer cancel()
	select {
	case <-flow.exited:
	case <-waitCtx.Done():
		_ = flow.cmd.Process.Kill()
		<-flow.exited
		m.finishLogin(channelID, flow, LoginState{Phase: LoginFailed, Message: "Google 登录超时，请重新登录"})
		return m.LoginState(channelID), nil
	}
	if flow.exitErr != nil {
		m.finishLogin(channelID, flow, LoginState{Phase: LoginFailed, Message: "登录失败：" + lastLine(flow.output.String())})
		return m.LoginState(channelID), nil
	}
	m.forgetInspection(channelID)
	m.finishLogin(channelID, flow, LoginState{Phase: LoginSucceeded, Message: "已登录 Google。"})
	return m.LoginState(channelID), nil
}

func (m *Manager) finishLogin(channelID string, flow *loginFlow, state LoginState) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	if m.logins[channelID] == flow {
		flow.state = state
	}
}

// LoginState 返回渠道当前的登录流程状态。
func (m *Manager) LoginState(channelID string) LoginState {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	flow := m.logins[channelID]
	if flow == nil {
		return LoginState{Phase: LoginIdle}
	}
	return flow.state
}

// CancelLogin 结束渠道正在进行的登录流程。
func (m *Manager) CancelLogin(channelID string) {
	m.stateMu.Lock()
	flow := m.logins[channelID]
	delete(m.logins, channelID)
	m.stateMu.Unlock()
	if flow != nil {
		flow.stop()
	}
}

func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			return line
		}
	}
	return "Antigravity 没有输出原因"
}
