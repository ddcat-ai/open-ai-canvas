package handler

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"yingce/backend/internal/service"
)

// 静态资源由 Go 亲自解析 MIME，不依赖镜像里的 /etc/mime.types：一旦 wasm 退回
// application/octet-stream，浏览器会拒绝流式编译，前端体积最大的两个模块直接不可用。
func init() {
	for extension, contentType := range map[string]string{
		".js":          "text/javascript; charset=utf-8",
		".mjs":         "text/javascript; charset=utf-8",
		".css":         "text/css; charset=utf-8",
		".json":        "application/json",
		".map":         "application/json",
		".wasm":        "application/wasm",
		".svg":         "image/svg+xml",
		".woff":        "font/woff",
		".woff2":       "font/woff2",
		".webmanifest": "application/manifest+json",
		".glb":         "model/gltf-binary",
		".gltf":        "model/gltf+json",
	} {
		_ = mime.AddExtensionType(extension, contentType)
	}
}

// StaticSite 从本地目录承载前端构建产物，供桌面壳内嵌的本地服务使用。
// 目录或入口缺失时构造失败：宁可启动即报错，也不要在健康门通过后让窗口拿到全站 404。
type StaticSite struct {
	root  string
	index string
}

// NewStaticSite 校验目录并解析出绝对路径。空参数按配置错误处理，调用方应先判断变量是否为空。
func NewStaticSite(dir string) (*StaticSite, error) {
	trimmed := strings.TrimSpace(dir)
	if trimmed == "" {
		return nil, errors.New("静态承载目录为空")
	}
	root, err := filepath.Abs(trimmed)
	if err != nil {
		return nil, fmt.Errorf("解析静态承载目录：%w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("静态承载目录不可用：%w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("静态承载目录不是目录：%s", root)
	}
	index := filepath.Join(root, "index.html")
	entry, err := os.Stat(index)
	if err != nil {
		return nil, fmt.Errorf("静态承载目录缺少 index.html：%w", err)
	}
	if !entry.Mode().IsRegular() {
		return nil, fmt.Errorf("静态承载入口不是普通文件：%s", index)
	}
	return &StaticSite{root: root, index: index}, nil
}

// Root 返回解析后的绝对目录，用于启动日志。
func (s *StaticSite) Root() string {
	return s.root
}

// Serve 处理一个非 /api 请求：命中文件按文件返回，未命中的导航请求回退 SPA 入口。
func (s *StaticSite) Serve(c *gin.Context) {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.Status(http.StatusMethodNotAllowed)
		return
	}
	if target, ok := s.resolve(c.Request.URL.Path); ok {
		if info, err := os.Stat(target); err == nil && info.Mode().IsRegular() {
			serveStaticFile(c, target)
			return
		}
	}
	if !navigationRequest(c.Request.URL.Path, c.GetHeader("Accept")) {
		// 脚本、样式、图片未命中就如实 404：拿 index.html 顶替会让浏览器在
		// 错误的 MIME 类型上报错，把「资源缺失」伪装成「应用崩溃」。
		c.Status(http.StatusNotFound)
		return
	}
	serveStaticFile(c, s.index)
}

// resolve 把 URL 路径映射到 root 下的绝对路径；任何逃出 root 的路径都返回 false。
func (s *StaticSite) resolve(urlPath string) (string, bool) {
	// 反斜杠在 Windows 上是分隔符而 path.Clean 不处理它，NUL 直接让系统调用失败。
	if strings.ContainsAny(urlPath, "\\\x00") {
		return "", false
	}
	cleaned := path.Clean("/" + urlPath)
	target := filepath.Join(s.root, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
	relative, err := filepath.Rel(s.root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return target, true
}

func serveStaticFile(c *gin.Context, file string) {
	if strings.EqualFold(filepath.Ext(file), ".html") {
		// 入口 HTML 每次回源校验，否则升级后壳仍会加载旧入口引用的旧资源。
		c.Header("Cache-Control", "no-cache")
	}
	http.ServeFile(c.Writer, c.Request, file)
}

// navigationRequest 判断未命中的路径是否应按 SPA 深链回退到 index.html。
// 浏览器导航一定带 text/html；无扩展名的路径（createBrowserRouter 深链）同样按导航处理。
func navigationRequest(urlPath string, accept string) bool {
	if strings.Contains(accept, "text/html") {
		return true
	}
	return filepath.Ext(path.Base(urlPath)) == ""
}

// StaticSiteNoRouteHandler 组合静态承载与既有短代理：/api 路径语义不变，
// 其余路径在配置了静态目录时交给前端产物；未配置时与 SystemProxyNoRouteHandler 完全一致。
func StaticSiteNoRouteHandler(svc *service.Service, site *StaticSite) gin.HandlerFunc {
	proxy := SystemProxyNoRouteHandler(svc)
	if site == nil {
		return proxy
	}
	return func(c *gin.Context) {
		if isAPIPath(c.Request.URL.Path) {
			proxy(c)
			return
		}
		site.Serve(c)
	}
}

func isAPIPath(urlPath string) bool {
	return urlPath == "/api" || strings.HasPrefix(urlPath, "/api/")
}
