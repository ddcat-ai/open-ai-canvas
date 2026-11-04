package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/protocol"
)

// 目录只下发表格里的 auth 字段名（type / field / secretField），
// 用作者真实的即梦插件 manifest（auth 里还有 service / region）验证不会带出其它属性或密钥值。
func TestPluginProviderCatalogProjectsDeclaredAuthFieldNames(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"apiVersion":"yingce.plugin/v1","id":"authless-provider","version":"1.0.0","name":"Authless Provider","author":"Test","documentation":"# Authless Provider","contributes":{"providers":[{"id":"authless-image","label":"Authless Image","capabilities":["image"],"scopes":["admin.system-channel"],"create":{"method":"POST","path":"/v1/images/generations","fields":{"prompt":"request.prompt"}},"response":{"statusPaths":["status"]}}]}}`)
	if _, err := center.install(testPluginPackage(t, manifest), "authless-provider.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	catalog := (&Service{pluginRuntime: center}).PluginProviderCatalog(string(protocol.SurfaceAdminSystemChannel), string(protocol.CapabilityImage), false)

	var jimeng, midjourney, authless *PluginProviderCatalogItem
	for index := range catalog {
		switch catalog[index].ID {
		case "volcengine-jimeng-image":
			jimeng = &catalog[index]
		case "cangyuan-midjourney-v82":
			midjourney = &catalog[index]
		case "authless-image":
			authless = &catalog[index]
		}
	}

	if jimeng == nil || jimeng.Auth == nil {
		t.Fatalf("jimeng bundled provider is missing its declared auth: %#v", jimeng)
	}
	if jimeng.Auth.Type != "volcengine-v4" || jimeng.Auth.Field != "apiKey" || jimeng.Auth.SecretField != "secretKey" {
		t.Fatalf("jimeng auth = %#v, want type/apiKey/secretKey", jimeng.Auth)
	}
	payload, err := json.Marshal(jimeng)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Auth map[string]any `json:"auth"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Auth) != 3 {
		t.Fatalf("catalog auth must only carry type/field/secretField, got %#v", decoded.Auth)
	}
	for _, key := range []string{"type", "field", "secretField"} {
		if _, ok := decoded.Auth[key]; !ok {
			t.Fatalf("catalog auth is missing %q: %#v", key, decoded.Auth)
		}
	}
	for _, leaked := range []string{`"service"`, `"region"`, "cn-north-1", `"username"`} {
		if strings.Contains(string(payload), leaked) {
			t.Fatalf("catalog payload leaked auth attribute %q: %s", leaked, payload)
		}
	}

	if midjourney == nil || midjourney.Auth == nil {
		t.Fatalf("midjourney bundled provider is missing its declared auth: %#v", midjourney)
	}
	if midjourney.Auth.SecretField != "" {
		t.Fatalf("midjourney auth secretField = %q, want empty", midjourney.Auth.SecretField)
	}

	if authless == nil {
		t.Fatal("provider without any auth declaration is missing from the catalog")
	}
	if authless.Auth != nil {
		t.Fatalf("provider without declared auth must not project auth: %#v", authless.Auth)
	}
	authlessPayload, err := json.Marshal(authless)
	if err != nil {
		t.Fatal(err)
	}
	var authlessDecoded map[string]any
	if err := json.Unmarshal(authlessPayload, &authlessDecoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := authlessDecoded["auth"]; ok {
		t.Fatalf("provider without declared auth serialized an auth field: %s", authlessPayload)
	}
}
