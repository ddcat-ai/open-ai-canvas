package protocol

import (
	"context"
	"testing"
)

func TestImageBillingSeedream55OfficialPlugin(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-ark-seedream.yingce-plugin", "volcengine-ark-image")
	request := GenerationRequest{Capability: CapabilityImage, Model: "doubao-seedream-5-5-261028", Prompt: "a tree", AspectRatio: "1024x1024", ImageParameters: map[string]any{"layerDecomposition": false, "background": "transparent", "outputFormat": "png"}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["size"] != "1024x1024" || body["background"] != "transparent" || body["output_format"] != "png" {
		t.Fatalf("body=%#v", body)
	}
	request.Images = []MediaReference{{URL: "https://example.com/input.png"}}
	request.ImageParameters = map[string]any{"layerDecomposition": true, "maxImages": 10, "layerSize": "auto", "background": "transparent", "outputFormat": "png"}
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body = spec.Body.(map[string]any)
	if body["layer_decomposition"] != true || body["size"] != "auto" || body["background"] != nil {
		t.Fatalf("layer body=%#v", body)
	}
	options := body["layer_decomposition_options"].(map[string]any)
	if manifestInt(options["max_images"]) != 10 {
		t.Fatalf("layer options=%#v", options)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"url":"https://example.com/output.png","size":"1536x1536","z_index":0,"name":"base"}],"usage":{"input_images":1,"generated_images":1}}`))
	if err != nil || created.Result == nil || created.Result.Images[0].Metadata["size"] != "1536x1536" || created.Result.Usage["input_images"] != float64(1) {
		t.Fatalf("created=%#v err=%v", created, err)
	}
}
