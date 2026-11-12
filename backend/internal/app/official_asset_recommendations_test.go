package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestRecommendationRequiresConsent(t *testing.T) {
	svc := &Service{}
	user := &model.User{}
	if _, err := svc.CreateOfficialAssetRecommendation(user, "asset", "", ""); err == nil {
		t.Fatal("recommendation without consent must fail")
	}
	if _, err := svc.ResubmitOfficialAssetRecommendation(user, "id", "", "unknown"); err == nil {
		t.Fatal("resubmission with unknown consent must fail")
	}
}

func TestPayloadResourceID(t *testing.T) {
	tests := []struct {
		name string
		json string
		want string
	}{
		{name: "file url", json: `{"coverUrl":"/api/resources/res_image/file"}`, want: "res_image"},
		{name: "storage key", json: `{"data":{"storageKey":"resource:res_video"}}`, want: "res_video"},
		{name: "video before cover", json: `{"coverUrl":"/api/resources/res_cover/file","data":{"url":"/api/resources/res_video/file","storageKey":"resource:res_video"}}`, want: "res_video"},
		{name: "nested data url", json: `{"items":[{"dataUrl":"/api/resources/res_audio/file?download=1"}]}`, want: "res_audio"},
		{name: "malformed", json: `{`, want: ""},
		{name: "invalid resource", json: `{"dataUrl":"https://example.com/image.png"}`, want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := (&Service{}).payloadResourceID(tt.json); got != tt.want {
				t.Fatalf("payloadResourceID() = %q, want %q", got, tt.want)
			}
		})
	}
}
