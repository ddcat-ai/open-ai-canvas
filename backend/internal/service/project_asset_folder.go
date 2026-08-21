package service

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const projectAssetFolderMaxDepth = 8

type CreateProjectAssetFolderRequest struct {
	Name     string `json:"name"`
	ParentID string `json:"parentId"`
	Style    string `json:"style"`
	Theme    string `json:"theme"`
}

type UpdateProjectAssetFolderRequest struct {
	Name     *string `json:"name"`
	ParentID *string `json:"parentId"`
	Style    *string `json:"style"`
	Theme    *string `json:"theme"`
}

func (s *Service) ProjectAssetFolders(userID string, projectID string) ([]model.ProjectAssetFolder, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	return s.repo.ProjectAssetFolders(projectID)
}

func (s *Service) CreateProjectAssetFolder(userID string, projectID string, req CreateProjectAssetFolderRequest) (model.ProjectAssetFolder, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.ProjectAssetFolder{}, err
	}
	folders, err := s.repo.ProjectAssetFolders(projectID)
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	name, err := validateProjectAssetFolderName(req.Name)
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	parentID := strings.TrimSpace(req.ParentID)
	if err := validateProjectAssetFolderParent(folders, "", parentID); err != nil {
		return model.ProjectAssetFolder{}, err
	}
	if projectAssetFolderNameExists(folders, parentID, name, "") {
		return model.ProjectAssetFolder{}, BadAuthRequest("同级目录下已存在同名文件夹")
	}
	position := nextProjectAssetFolderPosition(folders, parentID)
	now := time.Now()
	style, err := validateProjectAssetFolderStyle(req.Style)
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	theme, err := validateProjectAssetFolderTheme(req.Theme)
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	folder := model.ProjectAssetFolder{ID: newID(), ProjectID: projectID, ParentID: parentID, Name: name, NameKey: projectAssetFolderNameKey(name), Style: style, Theme: theme, Position: position, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateProjectAssetFolder(&folder); err != nil {
		if isProjectAssetFolderNameConflict(err) {
			return model.ProjectAssetFolder{}, BadAuthRequest("同级目录下已存在同名文件夹")
		}
		return model.ProjectAssetFolder{}, err
	}
	return folder, nil
}

func (s *Service) UpdateProjectAssetFolder(userID string, projectID string, folderID string, req UpdateProjectAssetFolderRequest) (model.ProjectAssetFolder, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.ProjectAssetFolder{}, err
	}
	folder, err := s.repo.ProjectAssetFolder(projectID, strings.TrimSpace(folderID))
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	folders, err := s.repo.ProjectAssetFolders(projectID)
	if err != nil {
		return model.ProjectAssetFolder{}, err
	}
	if req.Name != nil {
		name, nameErr := validateProjectAssetFolderName(*req.Name)
		if nameErr != nil {
			return model.ProjectAssetFolder{}, nameErr
		}
		folder.Name = name
		folder.NameKey = projectAssetFolderNameKey(name)
	}
	if req.ParentID != nil {
		parentID := strings.TrimSpace(*req.ParentID)
		if err := validateProjectAssetFolderParent(folders, folder.ID, parentID); err != nil {
			return model.ProjectAssetFolder{}, err
		}
		if parentID != folder.ParentID {
			folder.ParentID = parentID
			folder.Position = nextProjectAssetFolderPosition(folders, parentID)
		}
	}
	if req.Style != nil {
		style, styleErr := validateProjectAssetFolderStyle(*req.Style)
		if styleErr != nil {
			return model.ProjectAssetFolder{}, styleErr
		}
		folder.Style = style
	}
	if req.Theme != nil {
		theme, themeErr := validateProjectAssetFolderTheme(*req.Theme)
		if themeErr != nil {
			return model.ProjectAssetFolder{}, themeErr
		}
		folder.Theme = theme
	}
	if projectAssetFolderNameExists(folders, folder.ParentID, folder.Name, folder.ID) {
		return model.ProjectAssetFolder{}, BadAuthRequest("同级目录下已存在同名文件夹")
	}
	folder.UpdatedAt = time.Now()
	if err := s.repo.UpdateProjectAssetFolder(folder); err != nil {
		if isProjectAssetFolderNameConflict(err) {
			return model.ProjectAssetFolder{}, BadAuthRequest("同级目录下已存在同名文件夹")
		}
		return model.ProjectAssetFolder{}, err
	}
	return *folder, nil
}

func (s *Service) DeleteProjectAssetFolder(userID string, projectID string, folderID string) error {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return err
	}
	err := s.repo.DeleteProjectAssetFolder(projectID, strings.TrimSpace(folderID))
	if errors.Is(err, repository.ErrProjectAssetFolderNotEmpty) {
		return BadAuthRequest("文件夹非空，请先移动其中的素材和子文件夹")
	}
	return err
}

func (s *Service) resolveProjectAssetFolderID(projectID string, requested *string) (string, error) {
	if requested == nil || strings.TrimSpace(*requested) == "" {
		return "", nil
	}
	folderID := strings.TrimSpace(*requested)
	if _, err := s.repo.ProjectAssetFolder(projectID, folderID); err != nil {
		return "", BadAuthRequest("目标文件夹不存在或不属于当前素材库")
	}
	return folderID, nil
}

func validateProjectAssetFolderStyle(value string) (string, error) {
	style := strings.TrimSpace(value)
	if style == "" {
		return "glass", nil
	}
	switch style {
	case "glass", "stacked", "midnight", "paper", "cinema", "compact":
		return style, nil
	default:
		return "", BadAuthRequest("不支持的文件夹样式")
	}
}

func validateProjectAssetFolderTheme(value string) (string, error) {
	theme := strings.TrimSpace(value)
	if theme == "" {
		return "aurora", nil
	}
	switch theme {
	case "aurora", "obsidian", "ember", "pearl":
		return theme, nil
	default:
		return "", BadAuthRequest("不支持的文件夹主题")
	}
}

func validateProjectAssetFolderName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", BadAuthRequest("文件夹名称不能为空")
	}
	if len([]rune(name)) > 60 {
		return "", BadAuthRequest("文件夹名称不能超过 60 个字符")
	}
	return name, nil
}

func validateProjectAssetFolderParent(folders []model.ProjectAssetFolder, folderID string, parentID string) error {
	byID := make(map[string]model.ProjectAssetFolder, len(folders))
	for _, folder := range folders {
		byID[folder.ID] = folder
	}
	ancestorDepth := 0
	currentID := parentID
	seen := make(map[string]struct{}, projectAssetFolderMaxDepth)
	for currentID != "" {
		if currentID == folderID && folderID != "" {
			return BadAuthRequest("文件夹不能移动到自身或其子目录")
		}
		if _, exists := seen[currentID]; exists {
			return BadAuthRequest("文件夹目录关系存在循环")
		}
		seen[currentID] = struct{}{}
		current, ok := byID[currentID]
		if !ok {
			return BadAuthRequest("父文件夹不存在或不属于当前项目")
		}
		ancestorDepth++
		currentID = current.ParentID
	}
	subtreeHeight := projectAssetFolderSubtreeHeight(folders, folderID)
	if ancestorDepth+subtreeHeight > projectAssetFolderMaxDepth {
		return BadAuthRequest("文件夹层级不能超过 8 层")
	}
	return nil
}

func projectAssetFolderSubtreeHeight(folders []model.ProjectAssetFolder, folderID string) int {
	if folderID == "" {
		return 1
	}
	maxDepth := 1
	queue := []struct {
		id    string
		depth int
	}{{id: folderID, depth: 1}}
	seen := map[string]struct{}{folderID: {}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.depth > maxDepth {
			maxDepth = current.depth
		}
		for _, folder := range folders {
			if folder.ParentID != current.id {
				continue
			}
			if _, exists := seen[folder.ID]; exists {
				continue
			}
			seen[folder.ID] = struct{}{}
			queue = append(queue, struct {
				id    string
				depth int
			}{id: folder.ID, depth: current.depth + 1})
		}
	}
	return maxDepth
}

func projectAssetFolderNameExists(folders []model.ProjectAssetFolder, parentID string, name string, excludeID string) bool {
	for _, folder := range folders {
		if folder.ID != excludeID && folder.ParentID == parentID && strings.EqualFold(folder.Name, name) {
			return true
		}
	}
	return false
}

func projectAssetFolderNameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func isProjectAssetFolderNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "idx_project_asset_folders_sibling_name") || strings.Contains(message, "unique constraint") || strings.Contains(message, "duplicate key")
}

func nextProjectAssetFolderPosition(folders []model.ProjectAssetFolder, parentID string) int {
	position := 0
	for _, folder := range folders {
		if folder.ParentID == parentID && folder.Position >= position {
			position = folder.Position + 1
		}
	}
	return position
}
