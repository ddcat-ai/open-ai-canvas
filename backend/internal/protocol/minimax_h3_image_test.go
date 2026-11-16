package protocol

import (
	"context"
	"strings"
	"testing"
)

// MiniMax H3 Image 是 /v1/images/generations 与 /v1/images/edits 的独立协议，
// 与旧 minimax-image（/v1/image_generation）字段不同。这里逐字段固定线协议，
// 防止宿主的 OpenAI 补全逻辑把 quality/background 或像素 size 混进请求。
func minimaxH3Adapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "minimax-h3-image.yingce-plugin", "minimax-h3-image")
}

func minimaxH3Body(t *testing.T, request GenerationRequest) (RequestSpec, map[string]any) {
	t.Helper()
	spec, err := minimaxH3Adapter(t).BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	return spec, manifestTestBody(t, spec)
}

func TestMiniMaxH3ImageTextToImageSendsDocumentedFields(t *testing.T) {
	adapter := minimaxH3Adapter(t)
	metadata := adapter.Metadata()
	if metadata.RequiresPublicMediaURLs {
		t.Fatal("H3 edits 支持 data URI 参考图，不应强制公共媒体 URL")
	}
	spec, body := minimaxH3Body(t, GenerationRequest{
		Capability: CapabilityImage, Model: "MiniMax-H3-Image", Prompt: "窗台上晒太阳的橘猫", AspectRatio: "16:9", Resolution: "4k", ImageCount: 2,
		ImageParameters: map[string]any{"size": "16:9", "imageResolution": "4k", "count": 2, "quality": "high", "transparentBackground": true},
	})
	if spec.Method != "POST" || spec.Path != "/v1/images/generations" || spec.ContentType != "application/json" {
		t.Fatalf("spec = %#v", spec)
	}
	if spec.Auth.Type != "bearer" || spec.Auth.Field != "apiKey" {
		t.Fatalf("auth = %#v", spec.Auth)
	}
	want := map[string]any{"model": "MiniMax-H3-Image", "prompt": "窗台上晒太阳的橘猫", "n": float64(2), "size": "auto", "aspect_ratio": "16:9", "area": "4K", "response_format": "url"}
	for key, value := range want {
		if body[key] != value {
			t.Fatalf("%s = %#v, want %#v (body = %#v)", key, body[key], value, body)
		}
	}
	for _, forbidden := range []string{"images", "quality", "background", "output_format", "output_compression", "resolution", "mask", "stream"} {
		if _, present := body[forbidden]; present {
			t.Fatalf("body = %#v, 不应发送 %s", body, forbidden)
		}
	}
}

func TestMiniMaxH3ImageSizeAspectAndAreaCombinations(t *testing.T) {
	tests := []struct {
		name, aspect, resolution string
		wantSize, wantAspect     string
		wantArea                 string
	}{
		{name: "未设置分辨率默认 2K", aspect: "1:1", wantSize: "auto", wantAspect: "1:1", wantArea: "2K"},
		{name: "小写档位规范为大写", aspect: "3:4", resolution: "1k", wantSize: "auto", wantAspect: "3:4", wantArea: "1K"},
		{name: "auto 比例不发送 aspect_ratio 但仍发送 area", aspect: "auto", resolution: "2K", wantSize: "auto", wantArea: "2K"},
		{name: "空比例同样默认 2K，避免上游默认 4K", aspect: "", wantSize: "auto", wantArea: "2K"},
		{name: "极限比例 3:1", aspect: "3:1", resolution: "4K", wantSize: "auto", wantAspect: "3:1", wantArea: "4K"},
		{name: "像素尺寸只发送 size", aspect: "2720x1536", resolution: "4K", wantSize: "2720x1536"},
		{name: "像素尺寸大写 X 规范为小写", aspect: " 1536X2720 ", wantSize: "1536x2720"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, body := minimaxH3Body(t, GenerationRequest{Capability: CapabilityImage, Model: "MiniMax-H3-Image-Highspeed", Prompt: "城市夜景", AspectRatio: test.aspect, Resolution: test.resolution})
			if body["size"] != test.wantSize {
				t.Fatalf("size = %#v, want %q", body["size"], test.wantSize)
			}
			if test.wantAspect == "" {
				if value, present := body["aspect_ratio"]; present {
					t.Fatalf("aspect_ratio = %#v, 不应发送", value)
				}
			} else if body["aspect_ratio"] != test.wantAspect {
				t.Fatalf("aspect_ratio = %#v, want %q", body["aspect_ratio"], test.wantAspect)
			}
			if test.wantArea == "" {
				if value, present := body["area"]; present {
					t.Fatalf("area = %#v, 像素尺寸模式下上游会拒绝 area", value)
				}
			} else if body["area"] != test.wantArea {
				t.Fatalf("area = %#v, want %q", body["area"], test.wantArea)
			}
			if body["n"] != float64(1) {
				t.Fatalf("n = %#v, 未设置时为 1", body["n"])
			}
		})
	}
}

func TestMiniMaxH3ImageEditsKeepReferenceOrder(t *testing.T) {
	spec, body := minimaxH3Body(t, GenerationRequest{
		Capability: CapabilityImage, Model: "MiniMax-H3-Image", Prompt: "把图1的猫放进图2的房间", AspectRatio: "4:3", Resolution: "2K",
		Images: []MediaReference{
			{URL: "https://cdn.example/room.png", Role: "reference_image", Order: 2},
			{DataURL: "data:image/png;base64,QUJD", Role: "edit_source", Order: 0},
			{URL: "https://cdn.example/cat.png", Order: 1},
		},
	})
	if spec.Path != "/v1/images/edits" {
		t.Fatalf("path = %q, 有参考图必须走 edits", spec.Path)
	}
	images, ok := body["images"].([]any)
	if !ok || len(images) != 3 {
		t.Fatalf("images = %#v", body["images"])
	}
	for index, want := range []string{"data:image/png;base64,QUJD", "https://cdn.example/cat.png", "https://cdn.example/room.png"} {
		item, _ := images[index].(map[string]any)
		if len(item) != 1 || item["image_url"] != want {
			t.Fatalf("images[%d] = %#v, want image_url %q（按 order 排序）", index, images[index], want)
		}
	}
	if body["size"] != "auto" || body["aspect_ratio"] != "4:3" || body["area"] != "2K" {
		t.Fatalf("body = %#v", body)
	}
}

func TestMiniMaxH3ImageOutputFormatUsesPluginNamespace(t *testing.T) {
	_, body := minimaxH3Body(t, GenerationRequest{
		Capability: CapabilityImage, Model: "MiniMax-H3-Image", Prompt: "海报", AspectRatio: "9:16",
		ImageParameters: map[string]any{"outputFormat": "png", "outputCompression": 0},
	})
	if body["output_format"] != "png" || body["output_compression"] != float64(0) {
		t.Fatalf("body = %#v, 输出格式与压缩质量应按插件命名空间下发，0 也要保留", body)
	}
}

func TestMiniMaxH3ImageRejectsUnsupportedInputs(t *testing.T) {
	base := func() GenerationRequest {
		return GenerationRequest{Capability: CapabilityImage, Model: "MiniMax-H3-Image", Prompt: "x", AspectRatio: "1:1"}
	}
	images := func(count int) []MediaReference {
		items := make([]MediaReference, count)
		for index := range items {
			items[index] = MediaReference{URL: "https://cdn.example/ref.png", Order: index}
		}
		return items
	}
	tests := []struct {
		name    string
		mutate  func(*GenerationRequest)
		message string
	}{
		{name: "未知模型", mutate: func(r *GenerationRequest) { r.Model = "image-01" }, message: "仅支持"},
		{name: "空提示词", mutate: func(r *GenerationRequest) { r.Prompt = "   " }, message: "提示词"},
		{name: "超长提示词", mutate: func(r *GenerationRequest) { r.Prompt = strings.Repeat("猫", 32001) }, message: "32000"},
		{name: "超过 16 张参考图", mutate: func(r *GenerationRequest) { r.Images = images(17) }, message: "16"},
		{name: "蒙版", mutate: func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png"}, {URL: "https://cdn.example/m.png", Role: "mask", Order: 1}}
		}, message: "mask"},
		{name: "生成数量超过 10", mutate: func(r *GenerationRequest) { r.ImageCount = 11 }, message: "1 到 10"},
		{name: "比例超过 3:1", mutate: func(r *GenerationRequest) { r.AspectRatio = "4:1" }, message: "1:3 到 3:1"},
		{name: "比例低于 1:3", mutate: func(r *GenerationRequest) { r.AspectRatio = "1:4" }, message: "1:3 到 3:1"},
		{name: "比例分量超过 300", mutate: func(r *GenerationRequest) { r.AspectRatio = "301:300" }, message: "1:3 到 3:1"},
		{name: "非整数比例", mutate: func(r *GenerationRequest) { r.AspectRatio = "1.5:1" }, message: "1:3 到 3:1"},
		{name: "像素面积过小", mutate: func(r *GenerationRequest) { r.AspectRatio = "512x512" }, message: "655360"},
		{name: "像素面积过大", mutate: func(r *GenerationRequest) { r.AspectRatio = "5000x5000" }, message: "655360"},
		{name: "像素比例越界", mutate: func(r *GenerationRequest) { r.AspectRatio = "4096x1024" }, message: "655360"},
		{name: "无法识别的尺寸", mutate: func(r *GenerationRequest) { r.AspectRatio = "wide" }, message: "1:3 到 3:1"},
		{name: "不支持的分辨率", mutate: func(r *GenerationRequest) { r.Resolution = "8K" }, message: "1K、2K、4K"},
		{name: "不支持的输出格式", mutate: func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"minimax-h3-image": {"output_format": "gif"}}
		}, message: "jpeg、png、webp"},
	}
	adapter := minimaxH3Adapter(t)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := base()
			test.mutate(&request)
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("err = %v, want message containing %q", err, test.message)
			}
		})
	}
	// 边界值必须放行：16 张参考图、10 张输出、32000 字提示词、最小与最大像素面积。
	for _, accept := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Images = images(16) },
		func(r *GenerationRequest) { r.ImageCount = 10 },
		func(r *GenerationRequest) { r.Prompt = strings.Repeat("猫", 32000) },
		func(r *GenerationRequest) { r.AspectRatio = "1024x640" },
		func(r *GenerationRequest) { r.AspectRatio = "4000x5000" },
		func(r *GenerationRequest) { r.AspectRatio = "300:100" },
	} {
		request := base()
		accept(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err != nil {
			t.Fatalf("boundary request rejected: %v", err)
		}
	}
}

func TestMiniMaxH3ImageParsesURLBase64AndPartialFailures(t *testing.T) {
	adapter := minimaxH3Adapter(t)
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"created":1792308678,"data":[
		{"url":"https://example.com/h3-image/output-0.jpg","size":"2720x1536","revised_prompt":"..."},
		{"error":{"code":"1027","message":"output image failed content safety check"}},
		{"b64_json":"QUJD","size":"2720x1536"}
	],"output_format":"jpeg","usage":{"generated_images":2,"total_tokens":7254},"request_id":"req-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 2 {
		t.Fatalf("result = %#v", result)
	}
	first, second := result.Result.Images[0], result.Result.Images[1]
	if first.URL != "https://example.com/h3-image/output-0.jpg" || !first.Ephemeral {
		t.Fatalf("first = %#v, URL 24 小时内过期，必须标记 ephemeral", first)
	}
	if second.DataURL != "data:image/jpeg;base64,QUJD" || !second.Ephemeral {
		t.Fatalf("second = %#v, b64_json 必须按 output_format 生成 data URL", second)
	}
	if result.Result.Usage["generated_images"] != float64(2) {
		t.Fatalf("usage = %#v", result.Result.Usage)
	}
}

func TestMiniMaxH3ImageFailsWithoutUsableImages(t *testing.T) {
	adapter := minimaxH3Adapter(t)
	tests := []struct {
		name, body, message string
	}{
		{name: "全部单张失败", body: `{"data":[{"error":{"code":"1027","message":"output image failed content safety check"}}]}`, message: "content safety"},
		{name: "空 data", body: `{"data":[]}`, message: "没有返回可用图片"},
		{name: "未知响应", body: `{"request_id":"req-1"}`, message: "没有返回可用图片"},
		{name: "错误对象", body: `{"type":"error","error":{"type":"server_error","message":"internal error (1000)","http_code":"500"}}`, message: "internal error"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := adapter.ParseCreate(context.Background(), []byte(test.body))
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != StatusFailed || !strings.Contains(result.Message, test.message) {
				t.Fatalf("result = %#v, want failed with %q", result, test.message)
			}
			if result.Result != nil && len(result.Result.Images) > 0 {
				t.Fatalf("failed response must not carry images: %#v", result.Result)
			}
		})
	}
}

func TestMiniMaxH3ImageParameterContract(t *testing.T) {
	definitions := minimaxH3Adapter(t).Metadata().ImageParameters
	if err := ValidateImageParameters(definitions); err != nil {
		t.Fatal(err)
	}
	byName := map[string]ImageParameter{}
	for _, p := range definitions {
		byName[p.Name] = p
	}
	if p := byName["imageResolution"]; p.Default != "2K" || len(p.Values) != 3 || !p.Pricing {
		t.Fatalf("imageResolution = %#v, 默认 2K 并作为计价条件", p)
	}
	if p := byName["count"]; p.Max == nil || *p.Max != 10 {
		t.Fatalf("count = %#v", p)
	}
	for _, name := range []string{"quality", "transparentBackground", "outputFormat", "outputCompression"} {
		if p, ok := byName[name]; !ok || p.IsEnabled() {
			t.Fatalf("%s = %#v, 必须声明且默认停用", name, p)
		}
	}
	// 渠道套用 GPT Image 能力模板后启用 outputFormat，也必须有本插件自己的安全映射。
	enabled := true
	configured := []ImageParameter{
		{Name: "outputFormat", Label: "输出格式", Type: "string", Binding: "providerOptions.openai-image.output_format", Values: []any{"png", "jpeg", "webp"}, Default: "png", Enabled: &enabled},
		{Name: "outputCompression", Label: "压缩质量", Type: "integer", Binding: "providerOptions.openai-image.output_compression", Enabled: &enabled},
	}
	resolved, err := ResolveImageParameters(definitions, configured, "MiniMax-H3-Image")
	if err != nil {
		t.Fatalf("GPT Image 模板参数应能映射到 H3 命名空间: %v", err)
	}
	for _, p := range resolved {
		if p.Name == "outputFormat" && p.Binding != "providerOptions.minimax-h3-image.output_format" {
			t.Fatalf("outputFormat binding = %q, 必须使用插件自己的绑定", p.Binding)
		}
	}
	// 未声明的扩展参数仍然明确失败，不能静默透传。
	unknown := []ImageParameter{{Name: "seed", Label: "随机种子", Type: "integer", Binding: "providerOptions.openai-image.seed", Enabled: &enabled}}
	if _, err := ResolveImageParameters(definitions, unknown, "MiniMax-H3-Image"); err == nil || !strings.Contains(err.Error(), "安全映射") {
		t.Fatalf("unknown parameter err = %v", err)
	}
}
