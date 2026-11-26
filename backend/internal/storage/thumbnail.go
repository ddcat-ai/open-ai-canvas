package storage

import (
	"errors"
	"net/url"
	"time"
)

// The server owns this fixed transform; clients cannot request unbounded image processing.
const imageThumbnailProcess = "image/resize,l_960,limit_1/format,webp"

func SignedOriginImageThumbnailURL(setting Settings, objectKey string, signedAt, expires time.Time) (string, error) {
	if setting.Provider != aliyunOSSProvider {
		return "", errors.New("当前存储不支持 OSS 图片缩放")
	}
	signing := displayObjectURLSigning(signedAt, expires)
	signing.ImageProcess = imageThumbnailProcess
	return signedAliyunOSSObjectURL(setting, objectKey, signing)
}

func PublicCDNImageThumbnailURL(setting Settings, objectKey string) (string, error) {
	if setting.Provider != aliyunOSSProvider || setting.Delivery.CDNAuthMode != "public" {
		return "", errors.New("当前 CDN 不支持 OSS 图片缩放")
	}
	value, err := OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("x-oss-process", imageThumbnailProcess)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
