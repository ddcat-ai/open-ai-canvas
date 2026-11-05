package hostupdate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

var releaseDigest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

// Missing provenance is deliberately read-only, including installations made by older installers.
func (m *Manager) deploymentProtection(runtime bool) error {
	values, err := readEnvFile(m.envPath())
	if err != nil {
		return errors.New("无法读取部署来源，已禁止覆盖更新")
	}
	if values["CANVAS_UPDATE_POLICY"] != "managed" {
		return errors.New("当前为手动维护或来源未确认的部署，已禁止覆盖更新；请先保存自定义修复并发布自己的镜像")
	}
	if values["CANVAS_RELEASE_REPOSITORY"] != m.config.Repository {
		return errors.New("当前发行仓库与更新源不一致，已禁止跨发行方覆盖更新")
	}
	digest, err := composeDigest(m.composePath())
	if err != nil || values["CANVAS_RELEASE_COMPOSE_SHA256"] != digest {
		return errors.New("部署 Compose 已修改或缺少发布校验值，已禁止覆盖；请将定制编排纳入自己的发行版")
	}
	owner := strings.SplitN(m.config.Repository, "/", 2)[0]
	for _, service := range []struct{ name, key string }{
		{"backend", "CANVAS_BACKEND_IMAGE"}, {"web", "CANVAS_WEB_IMAGE"}, {"yingce-agent", "CANVAS_YINGCE_AGENT_IMAGE"},
	} {
		ref := values[service.key]
		prefix := "ghcr.io/" + owner + "/open-ai-canvas-" + service.name + "@"
		if !strings.HasPrefix(ref, prefix) || !releaseDigest.MatchString(strings.TrimPrefix(ref, prefix)) {
			return fmt.Errorf("%s 镜像未固定为当前发行方的 digest，已禁止覆盖自定义镜像", service.name)
		}
		if runtime {
			if err := m.protectRunningImage(service.name, ref); err != nil {
				return err
			}
		}
	}
	return nil
}

func composeDigest(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func (m *Manager) protectRunningImage(service, expected string) error {
	var ids bytes.Buffer
	version, err := m.currentVersion()
	if err != nil {
		return err
	}
	if err := m.compose(m.composePath(), version, 15*time.Second, &ids, "ps", "-q", service); err != nil {
		return fmt.Errorf("无法核验 %s 运行容器，已禁止更新", service)
	}
	containers := strings.Fields(ids.String())
	if len(containers) != 1 {
		return fmt.Errorf("%s 未唯一运行，无法核验部署来源", service)
	}
	var container struct {
		Image  string
		Config struct {
			Image  string
			Labels map[string]string
		}
		Mounts []struct{ Destination string }
	}
	if err := m.inspectProtection("container", containers[0], &container); err != nil {
		return err
	}
	if container.Config.Image != expected || container.Config.Labels["com.docker.compose.project.config_files"] != m.composePath() {
		return fmt.Errorf("%s 运行镜像或 Compose 与受管部署不一致，已禁止覆盖定制构建", service)
	}
	for _, mount := range container.Mounts {
		if protectedCodeMount(mount.Destination) {
			return fmt.Errorf("%s 挂载了程序代码目录，已禁止覆盖更新", service)
		}
	}
	var image struct{ RepoDigests []string }
	if err := m.inspectProtection("image", container.Image, &image); err != nil {
		return err
	}
	matched := false
	for _, digest := range image.RepoDigests {
		matched = matched || digest == expected
	}
	if !matched {
		return fmt.Errorf("%s 实际镜像缺少匹配的仓库 digest，可能是本地构建，已禁止更新", service)
	}
	var diff bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := m.runner.Run(ctx, "docker", []string{"diff", containers[0]}, nil, &diff, nil); err != nil {
		return fmt.Errorf("无法检查 %s 容器内代码修改，已禁止更新", service)
	}
	for _, line := range strings.Split(diff.String(), "\n") {
		if len(line) > 2 && protectedCodePath(strings.TrimSpace(line[2:])) {
			return fmt.Errorf("%s 容器内程序文件已修改，已禁止覆盖；请将修复提交并构建自己的镜像", service)
		}
	}
	return nil
}

func protectedCodePath(path string) bool {
	for _, root := range []string{"/app", "/usr/local/bin", "/opt/canvas-release"} {
		if path == root || strings.HasPrefix(path, root+"/") || path == "/" {
			return true
		}
	}
	return false
}

func protectedCodeMount(path string) bool {
	if protectedCodePath(path) {
		return true
	}
	for _, root := range []string{"/app", "/usr/local/bin", "/opt/canvas-release"} {
		if strings.HasPrefix(root, strings.TrimRight(path, "/")+"/") {
			return true
		}
	}
	return false
}

func (m *Manager) inspectProtection(kind, id string, target any) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var output bytes.Buffer
	if err := m.runner.Run(ctx, "docker", []string{kind, "inspect", "--format", "{{json .}}", id}, nil, &output, nil); err != nil {
		return errors.New("无法读取运行镜像来源，已禁止更新")
	}
	if err := json.Unmarshal(output.Bytes(), target); err != nil {
		return errors.New("镜像来源信息无效，已禁止更新")
	}
	return nil
}
