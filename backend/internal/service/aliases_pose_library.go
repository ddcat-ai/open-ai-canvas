package service

import "yingce/backend/internal/app"

const (
	PoseLibraryMaxImportBytes = app.PoseLibraryMaxImportBytes
	PoseLibraryMaxImageBytes  = app.PoseLibraryMaxImageBytes
	PoseLibraryFileThumb      = app.PoseLibraryFileThumb
	PoseLibraryFileImage      = app.PoseLibraryFileImage
)

type PoseLibraryFileVariant = app.PoseLibraryFileVariant
type PoseLibraryCatalogQuery = app.PoseLibraryCatalogQuery
type PoseLibraryAdminQuery = app.PoseLibraryAdminQuery
type PoseLibraryImportRequest = app.PoseLibraryImportRequest
type PoseLibrarySyncRequest = app.PoseLibrarySyncRequest
type PoseLibraryUpdateItemRequest = app.PoseLibraryUpdateItemRequest
type PoseLibraryBulkRequest = app.PoseLibraryBulkRequest
type PoseLibraryCreateItemRequest = app.PoseLibraryCreateItemRequest
