package service

import (
	"errors"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) OpenEagleItemThumbnail(rawBaseURL string, itemID string) (*EagleFile, error) {
	if strings.TrimSpace(itemID) == "" || strings.ContainsAny(itemID, "/\\?&") {
		return nil, BadAuthRequest("Eagle 素材 ID 无效")
	}
	baseURL, err := validateEagleBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	library, err := s.EagleLibrary(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string `json:"status"`
		Data   string `json:"data"`
	}
	if err := eagleJSONRequest(http.MethodGet, baseURL, "/api/item/thumbnail?id="+url.QueryEscape(itemID), nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" || strings.TrimSpace(response.Data) == "" {
		return nil, errors.New("Eagle 未返回缩略图路径")
	}
	thumbnailPath, err := url.PathUnescape(response.Data)
	if err != nil {
		return nil, errors.New("Eagle 缩略图路径编码无效")
	}
	thumbnailPath = filepath.Clean(filepath.FromSlash(thumbnailPath))
	itemDir := filepath.Join(filepath.Clean(filepath.FromSlash(library.LibraryPath)), "images", itemID+".info")
	rel, err := filepath.Rel(itemDir, thumbnailPath)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return nil, errors.New("Eagle 缩略图路径不在当前素材库内")
	}
	file, err := os.Open(thumbnailPath)
	if err != nil {
		return nil, errors.New("无法读取 Eagle 缩略图")
	}
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(thumbnailPath))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return &EagleFile{Path: thumbnailPath, Name: filepath.Base(thumbnailPath), Size: stat.Size(), MimeType: mimeType, Body: file}, nil
}
