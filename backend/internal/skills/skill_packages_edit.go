// 技能包在线编辑：作者以批量操作（写入 / 重命名 / 删除）修改文本文件，
// 服务端在当前版本基础上重建 ZIP 与 skill_files，生成新的技能版本。
//
// 并发：请求必须携带 baseVersionId；提交时在同一事务里按 current_version_id 做乐观锁，
// 任何并发写入（另一个标签页、GitHub 同步、旧编辑抽屉）都会让后到的请求得到 409 冲突。

package skills

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const (
	maxSkillEditOperations   = 256
	maxSkillEditPathDepth    = 8
	maxSkillEditSegmentBytes = 255
	// SkillPackageEditMaxBytes 是 PUT /skills/:id/files 的请求体上限：与安装上传同级，
	// 最终包大小仍以 maxSkillPackageBytes 校验。
	SkillPackageEditMaxBytes = SkillPackageUploadMaxBytes
)

const (
	SkillFileOperationWrite  = "write"
	SkillFileOperationDelete = "delete"
	SkillFileOperationRename = "rename"
)

type SkillPackageFileOperation struct {
	Op      string  `json:"op"`
	Path    string  `json:"path"`
	To      string  `json:"to,omitempty"`
	Content *string `json:"content,omitempty"`
}

type SkillPackageEditRequest struct {
	BaseVersionID string                      `json:"baseVersionId"`
	Operations    []SkillPackageFileOperation `json:"operations"`
}

type SkillPackageEditResult struct {
	Skill   *SkillItem             `json:"skill"`
	Files   []SkillPackageFileItem `json:"files"`
	Changed bool                   `json:"changed"`
}

func skillVersionConflict(currentVersionID string) *kernel.AppError {
	err := kernel.NewAppError(http.StatusConflict, "技能已在其他地方更新，请重新加载后再保存")
	err.Reason = kernel.ReasonSkillVersionConflict
	err.Details = map[string]any{"currentVersionId": currentVersionID}
	return err
}

// EditSkillPackageFiles 只允许作者修改；GitHub 技能以仓库为准，避免本地修改被下一次同步静默覆盖。
func (s *Service) EditSkillPackageFiles(userID string, skillID string, req SkillPackageEditRequest) (*SkillPackageEditResult, error) {
	skill, err := s.ownedSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	files, changed, err := s.editSkillPackage(skill, req, nil)
	if err != nil {
		return nil, err
	}
	item, err := s.SkillDetail(userID, skill.ID)
	if err != nil {
		return nil, err
	}
	return &SkillPackageEditResult{Skill: item, Files: files, Changed: changed}, nil
}

// editSkillPackage 在已完成权限校验的技能上应用文件操作并以乐观锁生成新版本，返回最新文件清单。
// adminEditedAt 非空表示管理员修改，会随新版本一起写入 admin_content_edited_at。
func (s *Service) editSkillPackage(skill *model.Skill, req SkillPackageEditRequest, adminEditedAt *time.Time) ([]SkillPackageFileItem, bool, error) {
	if skill.SourceType == "github" {
		appErr := kernel.NewAppError(http.StatusConflict, "GitHub 技能以仓库内容为准，请在仓库修改后执行同步")
		appErr.Reason = kernel.ReasonFailedPrecondition
		return nil, false, appErr
	}
	if len(req.Operations) == 0 {
		return nil, false, kernel.BadAuthRequest("没有需要保存的文件修改")
	}
	if len(req.Operations) > maxSkillEditOperations {
		return nil, false, kernel.BadAuthRequest("单次最多提交 256 个文件操作")
	}
	baseVersionID := strings.TrimSpace(req.BaseVersionID)
	if baseVersionID != skill.CurrentVersionID {
		return nil, false, skillVersionConflict(skill.CurrentVersionID)
	}
	snapshot, err := s.skillPackageSnapshot(skill)
	if err != nil {
		return nil, false, err
	}
	current := snapshot.contents
	if current == nil {
		current, err = readSkillArchiveEntries(s.dataDir, snapshot.version.PackageKey)
		if err != nil {
			return nil, false, err
		}
	}
	next := make(map[string][]byte, len(current)+len(req.Operations))
	for filePath, content := range current {
		next[filePath] = content
	}
	for index, operation := range req.Operations {
		if err := applySkillFileOperation(next, operation); err != nil {
			return nil, false, prefixSkillOperationError(index, err)
		}
	}
	if err := validateSkillPackageTree(next); err != nil {
		return nil, false, err
	}
	hash, total := contentHashAndSize(next)
	if total > maxSkillPackageBytes {
		return nil, false, kernel.BadAuthRequest("技能包总大小不能超过 20MB")
	}
	if !snapshot.legacy && hash == snapshot.version.ContentHash {
		return skillFileItems(snapshot), false, nil
	}

	metadata := parseSkillPackageMetadata(next["SKILL.md"])
	if metadata.Name == "" {
		metadata.Name = truncateSkillMetadata(skill.Name, 80)
	}
	if metadata.Description == "" {
		metadata.Description = truncateSkillMetadata(skill.Description, 500)
	}
	archive, err := finalizeSkillArchive(next, metadata)
	if err != nil {
		return nil, false, err
	}
	sourceType := strings.TrimSpace(skill.SourceType)
	switch {
	case sourceType == "":
		sourceType = "markdown"
	case sourceType == "markdown" && len(next) > 1:
		// 单文件编辑抽屉会用 instruction 重建整个包；多文件后转为技能包，避免附属文件被覆盖。
		sourceType = "zip"
	}
	skill.Instruction = string(next["SKILL.md"])
	if adminEditedAt != nil {
		skill.AdminContentEditedAt = adminEditedAt
	}
	if err := s.addSkillArchiveVersionIfCurrent(skill, archive, sourceType, baseVersionID); err != nil {
		return nil, false, err
	}
	latest, err := s.repo.SkillAnyStatus(skill.ID)
	if err != nil {
		return nil, false, err
	}
	saved, err := s.skillPackageSnapshot(latest)
	if err != nil {
		return nil, false, err
	}
	return skillFileItems(saved), true, nil
}

func (s *Service) addSkillArchiveVersionIfCurrent(skill *model.Skill, archive skillPackageArchive, sourceType string, baseVersionID string) error {
	versionID := kernel.NewID()
	packageKey, version, files, err := s.persistSkillArchive(skill.ID, versionID, archive, "")
	if err != nil {
		return err
	}
	removePackage := func() {
		_ = os.Remove(filepath.Join(s.dataDir, "skill-packages", filepath.FromSlash(packageKey)))
	}
	versionLabel := archive.Metadata.Version
	if versionLabel == "" {
		versionLabel = editedSkillVersionLabel()
	}
	version.VersionLabel = versionLabel
	applySkillArchiveVersion(skill, version, archive, sourceType, skill.SourceURL, skill.SourceRef, skill.SourceSubdir, "", false)
	applied, err := s.repo.AddSkillVersionIfCurrent(skill, version, files, baseVersionID)
	if err != nil {
		removePackage()
		return err
	}
	if !applied {
		removePackage()
		latest, latestErr := s.repo.SkillAnyStatus(skill.ID)
		if latestErr != nil {
			return skillVersionConflict("")
		}
		return skillVersionConflict(latest.CurrentVersionID)
	}
	return nil
}

func applySkillFileOperation(files map[string][]byte, operation SkillPackageFileOperation) error {
	switch strings.TrimSpace(operation.Op) {
	case SkillFileOperationWrite:
		filePath, err := normalizeSkillEditPath(operation.Path)
		if err != nil {
			return err
		}
		if operation.Content == nil {
			return kernel.BadAuthRequest("写入文件必须提供 content")
		}
		content := []byte(*operation.Content)
		if !utf8.Valid(content) {
			return kernel.BadAuthRequest("文件内容必须是 UTF-8 文本")
		}
		if len(content) > maxSkillPreviewBytes {
			return kernel.BadAuthRequest("单个文本文件不能超过 512KB")
		}
		if existing, ok := files[filePath]; ok && !isPreviewText(skillFileMime(filePath, existing), filePath) {
			return kernel.BadAuthRequest("二进制文件不支持在线编辑")
		}
		if !isPreviewText(skillFileMime(filePath, content), filePath) {
			return kernel.BadAuthRequest("该文件类型不支持作为文本编辑")
		}
		files[filePath] = content
		return nil
	case SkillFileOperationDelete:
		filePath, err := normalizeSkillEditPath(operation.Path)
		if err != nil {
			return err
		}
		if filePath == "SKILL.md" {
			return kernel.BadAuthRequest("SKILL.md 是技能入口，不能删除")
		}
		if _, ok := files[filePath]; !ok {
			return kernel.BadAuthRequest("要删除的文件不存在")
		}
		delete(files, filePath)
		return nil
	case SkillFileOperationRename:
		from, err := normalizeSkillEditPath(operation.Path)
		if err != nil {
			return err
		}
		to, err := normalizeSkillEditPath(operation.To)
		if err != nil {
			return err
		}
		if from == "SKILL.md" || to == "SKILL.md" {
			return kernel.BadAuthRequest("SKILL.md 是技能入口，不能重命名")
		}
		content, ok := files[from]
		if !ok {
			return kernel.BadAuthRequest("要重命名的文件不存在")
		}
		if from == to {
			return nil
		}
		if _, exists := files[to]; exists {
			return kernel.BadAuthRequest("目标路径已存在同名文件")
		}
		delete(files, from)
		files[to] = content
		return nil
	default:
		return kernel.BadAuthRequest("文件操作仅支持 write、rename、delete")
	}
}

// normalizeSkillEditPath 比安装校验更严格：只接受已经规范化的相对路径，
// 不替用户改写路径，避免浏览器与服务端对同一文件的认知不一致。
func normalizeSkillEditPath(value string) (string, error) {
	if !utf8.ValidString(value) {
		return "", kernel.BadAuthRequest("技能文件路径必须是 UTF-8")
	}
	clean, err := normalizeSkillPath(value)
	if err != nil {
		return "", err
	}
	if clean != value {
		return "", kernel.BadAuthRequest("技能文件路径必须是规范化的相对路径")
	}
	segments := strings.Split(clean, "/")
	if len(segments) > maxSkillEditPathDepth {
		return "", kernel.BadAuthRequest("技能文件目录层级不能超过 8 层")
	}
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." || len(segment) > maxSkillEditSegmentBytes {
			return "", kernel.BadAuthRequest("技能文件路径包含无效名称")
		}
		if strings.TrimSpace(segment) != segment {
			return "", kernel.BadAuthRequest("文件或文件夹名称不能以空格开头或结尾")
		}
		for _, r := range segment {
			if unicode.IsControl(r) {
				return "", kernel.BadAuthRequest("技能文件路径不能包含控制字符")
			}
		}
	}
	if segments[0] == "__MACOSX" || path.Base(clean) == ".DS_Store" {
		return "", kernel.BadAuthRequest("技能文件路径包含系统保留名称")
	}
	return clean, nil
}

// validateSkillPackageTree 保证 ZIP 能还原为一棵树：文件数量受限，文件与文件夹不重名。
func validateSkillPackageTree(files map[string][]byte) error {
	if _, ok := files["SKILL.md"]; !ok {
		return kernel.BadAuthRequest("技能包入口必须是 SKILL.md")
	}
	if len(files) > maxSkillPackageFiles {
		return kernel.BadAuthRequest("技能包文件数量不能超过 512 个")
	}
	folders := make(map[string]struct{}, len(files))
	for filePath := range files {
		for dir := path.Dir(filePath); dir != "." && dir != "/"; dir = path.Dir(dir) {
			folders[dir] = struct{}{}
		}
	}
	for filePath := range files {
		if _, conflict := folders[filePath]; conflict {
			return kernel.BadAuthRequest("文件 " + filePath + " 与同名文件夹冲突")
		}
	}
	return nil
}

func prefixSkillOperationError(index int, err error) error {
	appErr, ok := err.(*kernel.AppError)
	if !ok {
		return err
	}
	copyErr := *appErr
	copyErr.Details = map[string]any{"operationIndex": index}
	return &copyErr
}

func skillFileItems(snapshot *skillPackageSnapshot) []SkillPackageFileItem {
	items := make([]SkillPackageFileItem, 0, len(snapshot.files))
	for _, file := range snapshot.files {
		items = append(items, skillFileItem(file))
	}
	return items
}
