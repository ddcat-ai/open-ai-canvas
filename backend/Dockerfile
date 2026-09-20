# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS payment-package-build

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY

RUN apk add --no-cache nodejs unzip zip

WORKDIR /src
# 插件只下载实际依赖，不为四个小程序预取整个业务后端的模块图。
COPY backend ./backend
COPY plugin-packages ./plugin-packages
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build set -eu; \
    test -n "$TARGETOS"; \
    test -n "$TARGETARCH"; \
    PAYMENT_PLUGIN_GOOS="$TARGETOS" \
    PAYMENT_PLUGIN_GOARCH="$TARGETARCH" \
    PAYMENT_PLUGIN_CGO_ENABLED=0 \
      ./plugin-packages/build-packages.sh --payments-only; \
    sh ./plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH"

FROM alpine:3.22 AS payment-package-smoke

ARG TARGETOS
ARG TARGETARCH
RUN apk add --no-cache unzip
COPY --from=payment-package-build /src/plugin-packages /app/plugin-packages
RUN PAYMENT_PLUGIN_SMOKE_TEST=1 \
    sh /app/plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH"

FROM golang:1.25-alpine AS backend-build

ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY

RUN apk add --no-cache build-base

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
# 模块保留在普通镜像层中，供后续编译及跨 Runner 的 GHA 层缓存复用。
RUN go mod download
COPY backend ./
COPY VERSION /src/VERSION
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
RUN --mount=type=cache,target=/root/.cache/go-build set -eu; \
    version="${BUILD_VERSION:-$(tr -d '\r\n' </src/VERSION)}"; \
    ldflags="-s -w -X infinite-canvas/backend/internal/buildinfo.Version=${version} -X infinite-canvas/backend/internal/buildinfo.Commit=${BUILD_COMMIT} -X infinite-canvas/backend/internal/buildinfo.BuildTime=${BUILD_TIME}"; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/infinite-canvas-backend ./cmd/server; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/migrate-schema ./cmd/migrate-schema; \
    CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="$ldflags" -o /out/migrate-sqlite-postgres ./cmd/migrate-sqlite-postgres

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata wget \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app
ENV GIN_MODE=release
ENV CANVAS_BACKEND_ADDR=:8080
ENV CANVAS_BACKEND_DATA_DIR=/data

RUN mkdir -p /data && chown -R app:app /data
COPY --from=backend-build /out/infinite-canvas-backend /usr/local/bin/infinite-canvas-backend
COPY --from=backend-build /out/migrate-schema /usr/local/bin/migrate-schema
COPY --from=backend-build /out/migrate-sqlite-postgres /usr/local/bin/migrate-sqlite-postgres
COPY --from=payment-package-smoke /app/plugin-packages /app/plugin-packages

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health/ready >/dev/null || exit 1
CMD ["infinite-canvas-backend"]
