package app

import "infinite-canvas/backend/internal/storage"

type ossSettingValue = storage.Settings
type ossProviderCredentials = storage.Credentials
type ossObjectStream = storage.ObjectStream

var (
	putOSSObject                = storage.PutOSSObject
	putAliyunOSSObject          = storage.PutAliyunOSSObject
	getOSSObjectRange           = storage.GetOSSObjectRange
	getAliyunOSSObjectRange     = storage.GetAliyunOSSObjectRange
	signedOSSObjectURL          = storage.SignedOSSObjectURL
	signedOriginObjectURL       = storage.SignedOriginObjectURL
	getOriginOSSObjectRange     = storage.GetOriginObjectRange
	signedAliyunOSSObjectURL    = storage.SignedAliyunOSSObjectURL
	putCOSObject                = storage.PutCOSObject
	putQiniuObject              = storage.PutQiniuObject
	getCOSObjectRange           = storage.GetCOSObjectRange
	getQiniuObjectRange         = storage.GetQiniuObjectRange
	signedCOSObjectURL          = storage.SignedCOSObjectURL
	signedQiniuObjectURL        = storage.SignedQiniuObjectURL
	signedQiniuS3ObjectURL      = storage.SignedQiniuS3ObjectURL
	qiniuS3Region               = storage.QiniuS3Region
	qiniuRegion                 = storage.QiniuRegion
	newCOSClient                = storage.NewCOSClient
	cosBucketBaseURL            = storage.CosBucketBaseURL
	ossCDNBaseURL               = storage.OssCDNBaseURL
	ossCDNObjectURL             = storage.OssCDNObjectURL
	newOSSRequest               = storage.NewOSSRequest
	ossBucketBaseURL            = storage.OssBucketBaseURL
	escapeObjectKey             = storage.EscapeObjectKey
	deleteAliyunOSSObject       = storage.DeleteAliyunOSSObject
	deleteTencentCOSObject      = storage.DeleteTencentCOSObject
	deleteQiniuObject           = storage.DeleteQiniuObject
	validateStorageEndpoint     = storage.ValidateStorageEndpoint
	standardAWSS3Endpoint       = storage.StandardAWSS3Endpoint
	publicHTTPSStorageEndpoint  = storage.PublicHTTPSStorageEndpoint
	newS3Client                 = storage.NewS3Client
	putS3Object                 = storage.PutS3Object
	getS3ObjectRange            = storage.GetS3ObjectRange
	signedS3ObjectURL           = storage.SignedS3ObjectURL
	deleteS3Object              = storage.DeleteS3Object
	cloneOSSProviderCredentials = storage.CloneCredentials
	normalizeOSSSetting         = storage.NormalizeSettings
)
