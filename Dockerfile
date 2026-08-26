# syntax=docker/dockerfile:1.7

# Bridge 使用 Go 标准库交叉编译为原生 Windows/Linux 程序，避免把 Bun/Node 运行时打进下载文件。
FROM golang:1.24-alpine AS comfy-bridge-build

WORKDIR /src
COPY canvas-agent/native/comfy-bridge ./
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/OpenAICanvas-ComfyBridge.exe . \
    && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/OpenAICanvas-ComfyBridge-linux-amd64 . \
    && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o /out/OpenAICanvas-ComfyBridge-linux-arm64 .

# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
ARG VITE_TLDRAW_LICENSE_KEY
ENV VITE_TLDRAW_LICENSE_KEY=${VITE_TLDRAW_LICENSE_KEY}
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY canvas-agent /app/canvas-agent
COPY web ./
COPY --from=comfy-bridge-build /out/OpenAICanvas-ComfyBridge.exe /app/web/public/OpenAICanvas-ComfyBridge.exe
COPY --from=comfy-bridge-build /out/OpenAICanvas-ComfyBridge-linux-amd64 /app/web/public/OpenAICanvas-ComfyBridge-linux-amd64
COPY --from=comfy-bridge-build /out/OpenAICanvas-ComfyBridge-linux-arm64 /app/web/public/OpenAICanvas-ComfyBridge-linux-arm64
# Bun 1.3 与 TypeScript 7 的 tsc shim 在生产容器中解析路径异常；Bridge
# 已在上一步完成校验，生产镜像直接执行 Vite 打包，类型检查留给开发 CI。
RUN CANVAS_PREBUILT_BRIDGE=1 bun run build:bridge \
    && bun --bun ./node_modules/vite/bin/vite.js build

# 运行镜像：nginx 托管静态前端，并在 Compose 中把 /api 转发到后端服务。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
