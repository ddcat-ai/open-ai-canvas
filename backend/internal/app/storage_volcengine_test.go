package app

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go/aws/awserr"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
)

func TestVolcengineTOSSettingFromRequestNormalizesEndpointAndDropsS3Options(t *testing.T) {
	outboundtest.PublicDNS(t, "tos-s3-cn-beijing.volces.com")
	current := ossSettingValue{Provider: aliyunOSSProvider, AccessKeyID: "aliyun-id", AccessKeySecret: "aliyun-secret"}
	next, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: volcengineTOSProvider, Endpoint: "tos-cn-beijing.volces.com", Bucket: "canvas-assets",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value", SessionToken: "drop-me", PathStyle: true,
	}, current)
	if err != nil {
		t.Fatal(err)
	}
	if next.Region != "cn-beijing" || next.Endpoint != "https://tos-s3-cn-beijing.volces.com" || next.SessionToken != "" || next.PathStyle {
		t.Fatalf("next = %#v", next)
	}
	if _, err := validateActiveOSSSetting(next, "disabled", "incomplete"); err != nil {
		t.Fatalf("validateActiveOSSSetting() error = %v", err)
	}
	if !resourceStorageMatches(next, &model.Resource{Provider: volcengineTOSProvider, Endpoint: next.Endpoint, Bucket: "canvas-assets"}) {
		t.Fatal("resource written with the normalized endpoint must match the setting")
	}
	archived := archiveOSSProviderCredentials(next, current)
	if archived.ArchivedCredentials[aliyunOSSProvider].AccessKeySecret != "aliyun-secret" {
		t.Fatalf("previous provider credentials were not archived: %#v", archived.ArchivedCredentials)
	}
	if _, err := ossSettingFromRequest(OSSSettingRequest{Enabled: true, Provider: volcengineTOSProvider, Region: "cn-beijing", Bucket: "b", AccessKeyID: "id"}, current); err == nil || !strings.Contains(err.Error(), "SecretKey") {
		t.Fatalf("switching provider must not reuse another provider secret, error = %v", err)
	}
}

func TestVolcengineTOSSettingFromRequestRejectsInconsistentLocation(t *testing.T) {
	outboundtest.PublicDNS(t, "tos-s3-cn-beijing.volces.com")
	for name, item := range map[string]struct {
		req  OSSSettingRequest
		want string
	}{
		"missing location": {OSSSettingRequest{Enabled: true, Provider: volcengineTOSProvider, Bucket: "b", AccessKeyID: "id", AccessKeySecret: "s"}, "Region 或 Endpoint"},
		"region mismatch":  {OSSSettingRequest{Enabled: true, Provider: volcengineTOSProvider, Region: "cn-shanghai", Endpoint: "https://tos-s3-cn-beijing.volces.com", Bucket: "b", AccessKeyID: "id", AccessKeySecret: "s"}, "地域不一致"},
		"bucket mismatch":  {OSSSettingRequest{Enabled: true, Provider: volcengineTOSProvider, Endpoint: "https://other.tos-cn-beijing.volces.com", Bucket: "b", AccessKeyID: "id", AccessKeySecret: "s"}, "Bucket 与配置不一致"},
		"public http":      {OSSSettingRequest{Enabled: true, Provider: volcengineTOSProvider, Endpoint: "http://tos-s3-cn-beijing.volces.com", Bucket: "b", AccessKeyID: "id", AccessKeySecret: "s"}, "HTTP Endpoint"},
	} {
		if _, err := ossSettingFromRequest(item.req, ossSettingValue{}); err == nil || !strings.Contains(err.Error(), item.want) {
			t.Errorf("%s: error = %v, want %q", name, err, item.want)
		}
	}
	if !supportedResourceDeleteProvider(volcengineTOSProvider) {
		t.Fatal("volcengine resources must be deletable")
	}
	if _, _, _, err := normalizeAdminResourceQuery(AdminResourceQuery{Provider: volcengineTOSProvider}); err != nil {
		t.Fatalf("admin resource filter rejected volcengine: %v", err)
	}
}

func TestVolcengineTOSConnectionTestErrorsAreActionable(t *testing.T) {
	for status, want := range map[int]string{http.StatusForbidden: "鉴权失败", http.StatusNotFound: "未找到 Bucket", http.StatusBadRequest: "请求被拒绝"} {
		cause := fmt.Errorf("火山引擎 TOS 上传失败：%w", awserr.NewRequestFailure(awserr.New("Code", "upstream detail", nil), status, "request-id"))
		err := storageConnectionTestError(volcengineTOSProvider, "写入", cause)
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusBadGateway || !strings.Contains(appErr.Message, "火山引擎 TOS 写入"+want) {
			t.Errorf("%d: error = %#v", status, err)
		}
		if strings.Contains(appErr.Message, "upstream detail") {
			t.Errorf("%d: upstream detail leaked into the user message", status)
		}
	}
}
