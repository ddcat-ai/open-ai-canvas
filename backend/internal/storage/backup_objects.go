package storage

import (
	"context"
	"errors"
	"github.com/aws/aws-sdk-go/aws"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
	"io"
	"net/http"
	"time"
	"yingce/backend/internal/outbound"
)

func ReadBackupObject(ctx context.Context, setting Settings, key string) (io.ReadCloser, error) {
	address, err := SignedOriginObjectDownloadURL(setting, key, time.Now().Add(30*time.Minute), "backup.ycbk")
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	response, err := outbound.OutboundHTTPClient(transferTimeout(setting)).Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, errors.New("备份对象读取失败")
	}
	return response.Body, nil
}
func DeleteBackupObject(ctx context.Context, setting Settings, key string) error {
	if setting.Provider == s3Provider {
		client, err := NewS3Client(setting, transferTimeout(setting))
		if err != nil {
			return err
		}
		_, err = client.DeleteObjectWithContext(ctx, &awss3.DeleteObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(key)})
		return err
	}
	if setting.Provider != aliyunOSSProvider {
		return errors.New("不支持的备份存储")
	}
	req, err := NewOSSRequest(http.MethodDelete, setting, key, "", nil)
	if err != nil {
		return err
	}
	response, err := outbound.OutboundHTTPClient(transferTimeout(setting)).Do(req.WithContext(ctx))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound && (response.StatusCode < 200 || response.StatusCode >= 300) {
		return errors.New("备份对象删除失败")
	}
	return nil
}
