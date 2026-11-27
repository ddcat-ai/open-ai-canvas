package storage

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func TestAliyunThumbnailSignatureIncludesProcessingAndCacheParameters(t *testing.T) {
	setting := Settings{Provider: "aliyun", Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
	signedAt := time.Date(2026, time.November, 26, 3, 0, 0, 0, time.UTC)
	expires := signedAt.Add(time.Hour)
	value, err := SignedOriginImageThumbnailURL(setting, "folder/a b.png", signedAt, expires)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(value)
	query := parsed.Query()
	if query.Get("x-oss-process") != "image/resize,l_960,limit_1/format,webp" || query.Get("response-cache-control") != "private, max-age=3600, immutable" {
		t.Fatalf("thumbnail parameters = %s", value)
	}
	canonical := "/images/folder/a b.png?response-cache-control=private, max-age=3600, immutable&x-oss-process=image/resize,l_960,limit_1/format,webp"
	mac := hmac.New(sha1.New, []byte(setting.AccessKeySecret))
	mac.Write([]byte("GET\n\n\n" + strconv.FormatInt(expires.Unix(), 10) + "\n" + canonical))
	if query.Get("Signature") != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("OSS must verify the transform as part of the signature")
	}
	again, err := SignedOriginImageThumbnailURL(setting, "folder/a b.png", signedAt, expires)
	if err != nil || value != again {
		t.Fatalf("thumbnail URL must remain cacheable: %q %v", again, err)
	}
	original, err := SignedOriginObjectDisplayURL(setting, "folder/a b.png", signedAt, expires)
	if err != nil {
		t.Fatal(err)
	}
	originalQuery := mustParseQuery(t, original)
	if originalQuery.Has("x-oss-process") || originalQuery.Get("Signature") == query.Get("Signature") {
		t.Fatal("thumbnail signing must not modify or reuse the original signature")
	}
}
