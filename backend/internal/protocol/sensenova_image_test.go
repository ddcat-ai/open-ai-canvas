package protocol

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func sensenovaImageAdapter(t *testing.T) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "sensenova-image.yingce-plugin", "sensenova-image")
}

func sensenovaImageRequest() GenerationRequest {
	return GenerationRequest{Capability: CapabilityImage, Model: "sensenova-u1.6-lite", Prompt: "窗台上的猫", AspectRatio: "auto"}
}

func sensenovaImageBody(t *testing.T, request GenerationRequest) (RequestSpec, map[string]any) {
	t.Helper()
	spec, err := sensenovaImageAdapter(t).BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	return spec, manifestTestBody(t, spec)
}

func TestSenseNovaImageGenerationUsesDocumentedJSON(t *testing.T) {
	request := sensenovaImageRequest()
	request.ImageParameters = map[string]any{"size": "2720x1536", "count": 1, "quality": "auto", "transparentBackground": false}
	spec, body := sensenovaImageBody(t, request)
	if spec.Method != "POST" || spec.Path != "/v1/images/generations" || spec.ContentType != "application/json" || len(spec.Files) != 0 {
		t.Fatalf("spec = %#v", spec)
	}
	if spec.Auth.Type != "bearer" || spec.Auth.Field != "apiKey" {
		t.Fatalf("auth = %#v", spec.Auth)
	}
	want := map[string]any{"model": "sensenova-u1.6-lite", "prompt": "窗台上的猫", "size": "2720x1536", "n": float64(1), "response_format": "url", "output_format": "png", "watermark": false, "prompt_extend": true, "self_correction": true}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body = %#v, want %#v", body, want)
	}
	metadata := sensenovaImageAdapter(t).Metadata()
	if metadata.Version != "2.0.0" || metadata.RequiresPublicMediaURLs || metadata.Poll != "" || !reflect.DeepEqual(metadata.Categories, []Capability{CapabilityImage}) {
		t.Fatalf("metadata = %#v", metadata)
	}
}

func TestSenseNovaImageEditsUseOrderedJSONReferences(t *testing.T) {
	request := sensenovaImageRequest()
	request.Images = []MediaReference{
		{URL: "https://cdn.example/second.png", Role: "reference_image", Order: 2},
		{DataURL: "data:image/png;base64,QUJD", Role: "edit_source", Order: 0},
		{URL: "https://cdn.example/first.png", Role: "reference_image", Order: 1},
	}
	spec, body := sensenovaImageBody(t, request)
	if spec.Path != "/v1/images/edits" || spec.ContentType != "application/json" || len(spec.Files) != 0 {
		t.Fatalf("spec = %#v", spec)
	}
	images, ok := body["images"].([]any)
	if !ok || len(images) != 3 {
		t.Fatalf("images = %#v", body["images"])
	}
	for index, value := range []string{"data:image/png;base64,QUJD", "https://cdn.example/first.png", "https://cdn.example/second.png"} {
		if !reflect.DeepEqual(images[index], map[string]any{"image_url": value}) {
			t.Fatalf("images[%d] = %#v", index, images[index])
		}
	}
	for _, count := range []int{1, 5} {
		request.Images = make([]MediaReference, count)
		for index := range request.Images {
			request.Images[index] = MediaReference{URL: "http://cdn.example/reference.png", Order: index}
		}
		_, body = sensenovaImageBody(t, request)
		if len(body["images"].([]any)) != count {
			t.Fatalf("reference count = %#v", body["images"])
		}
	}
}

func TestSenseNovaImageSizeBoundaries(t *testing.T) {
	for _, size := range []string{"", "auto", " AUTO ", "512x512", "4096x4096", "1536x512", "512x1536", "2720x1536", "1536x2720", "1664x2496", "2496x1664", "2048x2048", " 2048X2048 ", "544x576"} {
		t.Run("accept/"+size, func(t *testing.T) {
			request := sensenovaImageRequest()
			request.AspectRatio = size
			_, body := sensenovaImageBody(t, request)
			want := strings.ToLower(strings.TrimSpace(size))
			if want == "" {
				want = "auto"
			}
			if body["size"] != want {
				t.Fatalf("size = %#v, want %q", body["size"], want)
			}
		})
	}
	for _, size := range []string{"480x512", "4128x4096", "1920x1080", "4096x512", "512x4096", "512.0x512", "512x512x512", "wide", "16:9", "2K", "4K", "0x512", "512x0"} {
		t.Run("reject/"+size, func(t *testing.T) {
			request := sensenovaImageRequest()
			request.AspectRatio = size
			_, err := sensenovaImageAdapter(t).BuildCreate(context.Background(), RequestContext{Request: request})
			if err == nil || !strings.Contains(err.Error(), "32") {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestSenseNovaImageProviderOptionsPreserveFalse(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "webp"} {
		request := sensenovaImageRequest()
		request.ImageParameters = map[string]any{"outputFormat": format, "watermark": false, "promptExtend": false, "selfCorrection": false}
		_, body := sensenovaImageBody(t, request)
		if body["output_format"] != format {
			t.Fatalf("output_format = %#v", body["output_format"])
		}
		for _, key := range []string{"watermark", "prompt_extend", "self_correction"} {
			if body[key] != false {
				t.Fatalf("%s = %#v, false must be preserved", key, body[key])
			}
		}
	}
}

func TestSenseNovaImageOptionalDefaultsAcceptMissingFields(t *testing.T) {
	for _, values := range []map[string]any{nil, {}, {"transparentBackground": false}, {"watermark": true, "promptExtend": true, "selfCorrection": true}} {
		request := sensenovaImageRequest()
		request.ImageParameters = values
		_, body := sensenovaImageBody(t, request)
		wantWatermark := values != nil && values["watermark"] == true
		if body["watermark"] != wantWatermark {
			t.Fatalf("watermark = %#v, want %t (missing must send false)", body["watermark"], wantWatermark)
		}
		for _, name := range []string{"prompt_extend", "self_correction"} {
			if body[name] != true {
				t.Fatalf("%s = %#v, missing options must use their documented true default", name, body[name])
			}
		}
		if _, present := body["background"]; present {
			t.Fatal("missing or false transparentBackground must not add a background field")
		}
	}
}

func TestSenseNovaImageRejectsUnsupportedInputs(t *testing.T) {
	tests := []struct {
		name, message string
		mutate        func(*GenerationRequest)
	}{
		{"unknown model", "sensenova-u1.6-lite", func(r *GenerationRequest) { r.Model = "sensenova-u1" }},
		{"empty prompt", "提示词", func(r *GenerationRequest) { r.Prompt = "   " }},
		{"six images", "5", func(r *GenerationRequest) {
			r.Images = make([]MediaReference, 6)
			for index := range r.Images {
				r.Images[index].URL = "https://cdn.example/reference.png"
			}
		}},
		{"mask", "mask", func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/mask.png", Role: "mask"}}
		}},
		{"bare base64", "Data URL", func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "QUJD"}} }},
		{"empty reference", "Data URL", func(r *GenerationRequest) { r.Images = []MediaReference{{}} }},
		{"video input", "视频", func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://cdn.example/a.mp4"}} }},
		{"audio input", "音频", func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://cdn.example/a.mp3"}} }},
		{"two outputs", "仅支持 1", func(r *GenerationRequest) { r.ImageCount = 2 }},
		{"negative count", "仅支持 1", func(r *GenerationRequest) { r.ImageCount = -1 }},
		{"quality", "quality", func(r *GenerationRequest) { r.ImageParameters = map[string]any{"quality": "high"} }},
		{"transparent background", "透明背景", func(r *GenerationRequest) { r.ImageParameters = map[string]any{"transparentBackground": true} }},
		{"gif output", "png、jpeg、webp", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"output_format": "gif"}}
		}},
		{"jpg output", "png、jpeg、webp", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"output_format": "jpg"}}
		}},
		{"non boolean switch", "布尔", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"watermark": "false"}}
		}},
		{"numeric switch", "布尔", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"watermark": 0}}
		}},
		{"empty string switch", "布尔", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"watermark": ""}}
		}},
		{"unknown option", "未知键", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"sensenova-image": {"seed": 1}}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := sensenovaImageRequest()
			test.mutate(&request)
			_, err := sensenovaImageAdapter(t).BuildCreate(context.Background(), RequestContext{Request: request})
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("err = %v, want %q", err, test.message)
			}
		})
	}
}

func TestSenseNovaImageParsesDocumentedURLResponse(t *testing.T) {
	result, err := sensenovaImageAdapter(t).ParseCreate(context.Background(), []byte(`{"created":1792308678,"data":[{"url":"https://cdn.example/output.png"}],"size":"2048x2048","output_format":"png","usage":{"input_tokens":569,"input_tokens_details":{"image_tokens":0,"text_tokens":569},"output_tokens":4096,"total_tokens":4665,"input_image_count":0,"output_image_count":1,"output_image_type":"HD"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.TaskID != "" || result.Result == nil || len(result.Result.Images) != 1 {
		t.Fatalf("result = %#v", result)
	}
	image := result.Result.Images[0]
	if image.URL != "https://cdn.example/output.png" || !image.Ephemeral || image.Metadata["size"] != "2048x2048" || image.Metadata["output_format"] != "png" {
		t.Fatalf("image = %#v", image)
	}
	wantUsage := map[string]any{
		"input_tokens": float64(569), "input_tokens_details": map[string]any{"image_tokens": float64(0), "text_tokens": float64(569)},
		"output_tokens": float64(4096), "total_tokens": float64(4665), "input_image_count": float64(0), "output_image_count": float64(1), "output_image_type": "HD",
		"input_images": float64(0), "generated_images": float64(1),
	}
	if !reflect.DeepEqual(result.Result.Usage, wantUsage) {
		t.Fatalf("usage = %#v", result.Result.Usage)
	}
}

func TestSenseNovaImageUsageAliasesDoNotInventMissingCounts(t *testing.T) {
	for _, test := range []struct {
		name, usage string
		want        map[string]any
	}{
		{"no counts", `{"total_tokens":123}`, map[string]any{"total_tokens": float64(123)}},
		{"only input zero", `{"input_image_count":0}`, map[string]any{"input_image_count": float64(0), "input_images": float64(0)}},
		{"only output", `{"output_image_count":1}`, map[string]any{"output_image_count": float64(1), "generated_images": float64(1)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"data":[{"url":"https://cdn.example/output.png"}],"usage":` + test.usage + `}`
			result, err := sensenovaImageAdapter(t).ParseCreate(context.Background(), []byte(body))
			if err != nil || result.Status != StatusSucceeded || result.Result == nil || !reflect.DeepEqual(result.Result.Usage, test.want) {
				t.Fatalf("result=%#v err=%v", result, err)
			}
		})
	}
}

// Synthetic fixture only: the public SenseNova response examples do not show the Base64 schema.
func TestSenseNovaImageSyntheticBase64HostCompatibility(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "webp"} {
		body := `{"data":[{"b64_json":"QUJD"}],"size":"2048x2048","output_format":"` + format + `"}`
		result, err := sensenovaImageAdapter(t).ParseCreate(context.Background(), []byte(body))
		if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 {
			t.Fatalf("result = %#v, err = %v", result, err)
		}
		if image := result.Result.Images[0]; image.DataURL != "data:image/"+format+";base64,QUJD" || !image.Ephemeral {
			t.Fatalf("image = %#v", image)
		}
	}
}

func TestSenseNovaImageFailsOnErrorOrMissingImages(t *testing.T) {
	for _, test := range []struct{ body, message string }{
		{`{"data":[]}`, "没有返回可用图片"},
		{`{"data":[{"url":"   "}]}`, "没有返回可用图片"},
		{`{"request_id":"fixture"}`, "没有返回可用图片"},
		{`{"data":[{"url":"https://cdn.example/a.png"},{"url":"https://cdn.example/b.png"}]}`, "n=1"},
		{`{"error":{},"data":[{"url":"https://cdn.example/invalid-success.png"}]}`, "错误对象"},
		{`{"error":{"type":"invalid_request_error","code":"3","message":"invalid size"}}`, "invalid size"},
		{`{"error":{"type":"failed_precondition_error","message":"safety check failed"},"data":[{"url":"https://cdn.example/invalid-success.png"}]}`, "safety check failed"},
	} {
		result, err := sensenovaImageAdapter(t).ParseCreate(context.Background(), []byte(test.body))
		if err != nil || result.Status != StatusFailed || !strings.Contains(result.Message, test.message) {
			t.Fatalf("result = %#v, err = %v", result, err)
		}
		if result.Result != nil && len(result.Result.Images) != 0 {
			t.Fatalf("failure carried images: %#v", result.Result)
		}
	}
}

func TestSenseNovaImageParameterContract(t *testing.T) {
	parameters := sensenovaImageAdapter(t).Metadata().ImageParameters
	if err := ValidateImageParameters(parameters); err != nil {
		t.Fatal(err)
	}
	byName := map[string]ImageParameter{}
	for _, parameter := range parameters {
		byName[parameter.Name] = parameter
	}
	if p := byName["size"]; p.Encoding != "pixels" || p.Default != "auto" || len(p.Values) != 7 {
		t.Fatalf("size = %#v", p)
	}
	if p := byName["count"]; p.Min == nil || p.Max == nil || *p.Min != 1 || *p.Max != 1 {
		t.Fatalf("count = %#v", p)
	}
	for _, name := range []string{"imageResolution", "quality", "transparentBackground"} {
		if p, ok := byName[name]; !ok || p.IsEnabled() {
			t.Fatalf("%s = %#v", name, p)
		}
	}
	for name, binding := range map[string]string{"outputFormat": "output_format", "watermark": "watermark", "promptExtend": "prompt_extend", "selfCorrection": "self_correction"} {
		if p := byName[name]; !p.IsEnabled() || p.Binding != "providerOptions.sensenova-image."+binding {
			t.Fatalf("%s = %#v", name, p)
		}
	}
	if p := byName["watermark"]; p.Default != true || !strings.Contains(p.Description, "false") {
		t.Fatalf("enabled watermark must retain its default and explain disabled behavior: %#v", p)
	}
}
