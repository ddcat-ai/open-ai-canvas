package storage

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// 展示地址的签名时间由调用方对齐；同一时间窗内重复签发必须得到逐字节相同的 URL，
// 否则浏览器 HTTP 缓存（以完整 URL 为键）在每次刷新画布时都会失效并重新下载对象。
func TestDisplayURLIsDeterministicForAlignedSigningTime(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	signedAt := time.Now().UTC().Truncate(time.Hour)
	expiresAt := signedAt.Add(24 * time.Hour)
	cases := map[string]Settings{
		"s3":      {Provider: s3Provider, Region: "cn-nb1", Endpoint: server.URL, Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value"},
		"qiniu":   {Provider: qiniuKodoProvider, Endpoint: "https://up-z0.qiniup.com", Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value"},
		"tencent": {Provider: tencentCOSProvider, Endpoint: "https://cos.ap-guangzhou.myqcloud.com", Bucket: "bucket-1250000000", AccessKeyID: "access-id", AccessKeySecret: "secret-value"},
		"aliyun":  {Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value"},
	}
	for name, setting := range cases {
		t.Run(name, func(t *testing.T) {
			first, err := SignedOriginObjectDisplayURL(setting, "users/u-1/image/a b.png", signedAt, expiresAt)
			if err != nil {
				t.Fatal(err)
			}
			time.Sleep(1100 * time.Millisecond) // 跨过秒级时间戳，证明结果不依赖 time.Now。
			second, err := SignedOriginObjectDisplayURL(setting, "users/u-1/image/a b.png", signedAt, expiresAt)
			if err != nil {
				t.Fatal(err)
			}
			if first != second {
				t.Fatalf("display URL is not stable:\n%s\n%s", first, second)
			}
			query := mustParseQuery(t, first)
			if got := query.Get("response-cache-control"); got != "private, max-age=86400, immutable" {
				t.Fatalf("response-cache-control = %q in %s", got, first)
			}
			if strings.Contains(first, "secret-value") {
				t.Fatal("signed URL leaked secret key")
			}
			switch name {
			case "s3", "qiniu":
				if query.Get("X-Amz-Date") != signedAt.Format("20060102T150405Z") || query.Get("X-Amz-Expires") != "86400" {
					t.Fatalf("SigV4 window = %s/%s", query.Get("X-Amz-Date"), query.Get("X-Amz-Expires"))
				}
			case "tencent":
				window := strings.Join([]string{itoa(signedAt.Unix()), itoa(expiresAt.Unix())}, ";")
				if query.Get("q-sign-time") != window || query.Get("q-key-time") != window {
					t.Fatalf("COS window = %s", first)
				}
			}
		})
	}
}

func TestOneShotURLsKeepCurrentTimeSigningWithoutCacheOverride(t *testing.T) {
	setting := Settings{Provider: qiniuKodoProvider, Endpoint: "https://up-z0.qiniup.com", Bucket: "bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value"}
	value, err := SignedOriginObjectDownloadURL(setting, "users/u-1/video/clip.mp4", time.Now().Add(time.Hour), "镜头.mp4")
	if err != nil {
		t.Fatal(err)
	}
	query := mustParseQuery(t, value)
	if query.Get("response-cache-control") != "" || !strings.HasPrefix(query.Get("response-content-disposition"), "attachment") {
		t.Fatalf("download URL = %s", value)
	}
	signedAt, err := time.Parse("20060102T150405Z", query.Get("X-Amz-Date"))
	if err != nil || time.Since(signedAt) > time.Minute {
		t.Fatalf("download URL must be signed at the current time, got %q", query.Get("X-Amz-Date"))
	}
}

func mustParseQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query()
}

func itoa(value int64) string {
	return strconv.FormatInt(value, 10)
}
