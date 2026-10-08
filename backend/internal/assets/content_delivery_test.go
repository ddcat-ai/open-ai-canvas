package assets

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/storage"
)

func TestNonMediaDeliveryUsesPlatform(t *testing.T) {
	for _, mimeType := range []string{"text/html", "image/svg+xml", "application/pdf", "application/octet-stream"} {
		for _, purpose := range []AccessPurpose{PurposeDisplay, PurposeCopy, PurposeProcess, PurposeDownload, PurposeProvider} {
			t.Run(mimeType+"/"+string(purpose), func(t *testing.T) {
				r := testReadyResource("aliyun")
				r.MimeType = mimeType
				var variants []ResourceVariant
				got, err := ResolveAccess(r, storage.Settings{Provider: "aliyun", CDNBaseURL: "https://cdn.example", Delivery: storage.DeliverySettings{CDNAuthMode: "public"}}, AccessOptions{Purpose: purpose}, time.Now(), testPlatformURL(&variants))
				if err != nil || got.Delivery != DeliveryProxy || len(variants) != 1 {
					t.Fatalf("non-media escaped controlled delivery: access=%+v err=%v", got, err)
				}
			})
		}
	}
}
