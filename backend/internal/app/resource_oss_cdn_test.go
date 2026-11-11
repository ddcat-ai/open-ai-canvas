package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
)

func TestBoundS3ResourcesUseCurrentCDNPolicyFromTheirScope(t *testing.T) {
	outboundtest.PublicDNS(t, "s3.us-east-1.amazonaws.com", "current-media.example.com")
	for _, test := range []struct {
		name       string
		scope      string
		otherScope bool
	}{
		{name: "platform", scope: "platform"},
		{name: "platform with personal storage", scope: "platform", otherScope: true},
		{name: "user with platform storage", scope: "user", otherScope: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			scope := test.scope
			svc := newResourceTestService(t)
			actor := &model.User{ID: "user-1", Role: model.UserRoleAdmin}
			historical := ossSettingValue{
				Enabled: true, Provider: s3Provider, S3Preset: "aws", Region: "us-east-1",
				Endpoint: "https://s3.us-east-1.amazonaws.com", Bucket: "private-bucket",
				CDNBaseURL: "https://old-media.example.com", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
			}
			ownerID := ""
			if scope == "user" {
				ownerID = actor.ID
			}
			location, err := svc.upsertStorageLocation(scope, ownerID, historical)
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			location.TestedAt = &now
			location.TestedDigest = storageTestDigest(historical)
			if err := svc.repo.SaveStorageLocation(location); err != nil {
				t.Fatal(err)
			}
			resource := model.Resource{
				ID: "bound-s3-image", UserID: actor.ID, Kind: "image", Status: model.ResourceStatusReady,
				Provider: historical.Provider, Endpoint: historical.Endpoint, Bucket: historical.Bucket,
				StorageSettingID: location.ID, ObjectKey: "users/user-1/image/reference.png", MimeType: "image/png",
			}
			if err := svc.repo.CreateResource(&resource); err != nil {
				t.Fatal(err)
			}
			if test.otherScope {
				opposite := historical
				opposite.CDNBaseURL = "https://other-scope.example.com"
				opposite.AllowUserS3 = true
				opposite.Delivery.CDNAuthMode = "public"
				encoded, err := json.Marshal(opposite)
				if err != nil {
					t.Fatal(err)
				}
				if scope == "platform" {
					err = svc.repo.CreateUserOSSSetting(&model.UserOSSSetting{ID: "personal-setting", UserID: actor.ID, Enabled: true, ValueJSON: string(encoded)})
				} else {
					err = svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)})
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			req := OSSSettingRequest{
				Enabled: true, Provider: historical.Provider, S3Preset: historical.S3Preset, Region: historical.Region,
				Endpoint: historical.Endpoint, Bucket: historical.Bucket, AccessKeyID: historical.AccessKeyID, AccessKeySecret: historical.AccessKeySecret,
				CDNBaseURL: "https://current-media.example.com", CDNAuthMode: "public", RequireCDN: true,
			}
			if scope == "platform" {
				_, err = svc.UpdateOSSSetting(actor, req)
			} else {
				_, err = svc.UpdateUserOSSSetting(actor, req)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, purpose := range []assets.AccessPurpose{assets.PurposeDisplay, assets.PurposeCopy, assets.PurposeProcess, assets.PurposeDownload} {
				t.Run(string(purpose), func(t *testing.T) {
					delivery, err := svc.PrepareResourceDelivery(actor.ID, resource.ID, ResourceAccessOptions{Purpose: purpose, DownloadName: "reference.png"}, "")
					if err != nil {
						t.Fatal(err)
					}
					parsed, err := url.Parse(delivery.Access.URL)
					if err != nil {
						t.Fatal(err)
					}
					if delivery.Access.Delivery != assets.DeliveryCDN || parsed.Host != "current-media.example.com" || parsed.Path != "/"+resource.ObjectKey || delivery.Stream != nil {
						t.Fatalf("resource did not follow its current %s CDN policy: access=%#v, stream=%#v", scope, delivery.Access, delivery.Stream)
					}
				})
			}
			media := providerMedia{StorageKey: "resource:" + resource.ID}
			if err := svc.hydrateProviderMedia(actor.ID, &media, providerMediaHydrationPolicy{preferURL: true}); err != nil {
				t.Fatal(err)
			}
			if media.URL != req.CDNBaseURL+"/"+resource.ObjectKey || media.DataURL != "" {
				t.Fatalf("provider reference did not use current CDN: %#v", media)
			}
			req.CDNAuthMode = ""
			if scope == "platform" {
				_, err = svc.UpdateOSSSetting(actor, req)
			} else {
				_, err = svc.UpdateUserOSSSetting(actor, req)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, purpose := range []assets.AccessPurpose{assets.PurposeDisplay, assets.PurposeProvider} {
				_, err := svc.resolveResourceAccess(&resource, ResourceAccessOptions{Purpose: purpose})
				var appErr *AppError
				if !errors.As(err, &appErr) || appErr.Reason != "resource_cdn_unconfigured" {
					t.Fatalf("required CDN did not reject incomplete current configuration for %s: %v", purpose, err)
				}
			}
		})
	}
}
