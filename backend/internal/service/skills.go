package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"golang.org/x/net/html"
)

const updreamSkillCommunityURL = "https://www.updream.cn/api/skills/community"

type CommunitySkillsRequest struct {
	Page       int
	PageSize   int
	Sort       string
	Search     string
	Categories []string
}

type CommunitySkillList struct {
	Skills     []UpdreamSkill `json:"skills"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"page_size"`
	Categories []string       `json:"categories"`
}

type SkillIntegrationCapabilities struct {
	Provider             string `json:"provider"`
	PublicCommunity      bool   `json:"publicCommunity"`
	CategoryFilter       bool   `json:"categoryFilter"`
	PublicRankings       bool   `json:"publicRankings"`
	PrivateAuthorization string `json:"privateAuthorization"`
	Upload               bool   `json:"upload"`
	Comments             bool   `json:"comments"`
}

func (s *Service) SkillIntegrationCapabilities() SkillIntegrationCapabilities {
	return SkillIntegrationCapabilities{Provider: "updream", PublicCommunity: true, CategoryFilter: true, PublicRankings: true, PrivateAuthorization: "not_configured", Upload: false, Comments: false}
}

type UpdreamSkill struct {
	Dir             string   `json:"dir"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	IconURL         string   `json:"icon_url"`
	CoverURL        string   `json:"cover_url"`
	DetailContent   string   `json:"detail_content"`
	DetailText      string   `json:"detail_text"`
	Categories      []string `json:"categories"`
	Version         int      `json:"version"`
	UploaderID      int64    `json:"uploader_id"`
	UploaderName    string   `json:"uploader_name"`
	UploaderAvatar  string   `json:"uploader_avatar"`
	IsPrivate       bool     `json:"is_private"`
	ReviewStatus    string   `json:"review_status"`
	CTime           string   `json:"ctime"`
	MTime           string   `json:"mtime"`
	FeaturedLabel   string   `json:"featured_label"`
	ActivationCount int      `json:"activation_count"`
	LikeCount       int      `json:"like_count"`
	UsageCount      int      `json:"usage_count"`
	CommentCount    int      `json:"comment_count"`
	RatingCount     int      `json:"rating_count"`
	AvgRating       *float64 `json:"avg_rating"`
	HotScore        int      `json:"hot_score"`
	Liked           bool     `json:"liked"`
	Activated       bool     `json:"activated"`
	UserRating      *float64 `json:"user_rating"`
	ShareScope      string   `json:"share_scope"`
	ShareTeamID     any      `json:"share_team_id"`
}

type updreamCommunityResponse struct {
	Skills   []UpdreamSkill `json:"skills"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

func (s *Service) CommunitySkills(ctx context.Context, userID string, req CommunitySkillsRequest) (*CommunitySkillList, error) {
	req = normalizeCommunitySkillsRequest(req)
	skillsURL, err := updreamCommunityListURL(req)
	if err != nil {
		return nil, err
	}
	var payload updreamCommunityResponse
	if err := fetchUpdreamJSON(ctx, skillsURL, &payload); err != nil {
		return nil, err
	}
	states, err := s.repo.UserSkillStatesByDirs(userID, skillDirs(payload.Skills))
	if err != nil {
		return nil, err
	}
	applyUserSkillStates(payload.Skills, states)
	for index := range payload.Skills {
		payload.Skills[index].DetailText = strings.TrimSpace(payload.Skills[index].Description)
		payload.Skills[index].DetailContent = ""
	}
	categories := []string{}
	for _, skill := range payload.Skills {
		categories = append(categories, skill.Categories...)
	}
	return &CommunitySkillList{Skills: payload.Skills, Total: payload.Total, Page: payload.Page, PageSize: payload.PageSize, Categories: cleanStringList(categories)}, nil
}

func (s *Service) CommunitySkillDetail(ctx context.Context, userID string, dir string) (*UpdreamSkill, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, BadAuthRequest("技能标识不能为空")
	}
	skill, err := fetchUpdreamSkillDetail(ctx, dir)
	if err != nil {
		return nil, err
	}
	states, err := s.repo.UserSkillStatesByDirs(userID, []string{dir})
	if err != nil {
		return nil, err
	}
	if len(states) > 0 {
		skill.Activated = states[0].Activated
		skill.Liked = states[0].Liked
	} else {
		skill.Activated = false
		skill.Liked = false
	}
	skill.DetailText = detailTextFromHTML(skill.DetailContent, skill.Description)
	skill.DetailContent = ""
	return skill, nil
}

func (s *Service) ActivatedSkills(ctx context.Context, userID string) ([]UpdreamSkill, error) {
	return s.userStateSkills(ctx, userID, func(state model.UserSkillState) bool { return state.Activated })
}

func (s *Service) FavoriteSkills(ctx context.Context, userID string) ([]UpdreamSkill, error) {
	return s.userStateSkills(ctx, userID, func(state model.UserSkillState) bool { return state.Liked })
}

func (s *Service) userStateSkills(ctx context.Context, userID string, pick func(model.UserSkillState) bool) ([]UpdreamSkill, error) {
	states, err := s.repo.UserSkillStates(userID)
	if err != nil {
		return nil, err
	}
	skills := make([]UpdreamSkill, 0, len(states))
	var firstErr error
	for _, state := range states {
		if !pick(state) {
			continue
		}
		skill, err := fetchUpdreamSkillDetail(ctx, state.SkillDir)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		skill.Activated = state.Activated
		skill.Liked = state.Liked
		skill.DetailText = detailTextFromHTML(skill.DetailContent, skill.Description)
		skill.DetailContent = ""
		skills = append(skills, *skill)
	}
	if len(skills) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return skills, nil
}

func (s *Service) SetSkillActivated(ctx context.Context, userID string, dir string, activated bool) (*UpdreamSkill, error) {
	skill, err := fetchUpdreamSkillDetail(ctx, strings.TrimSpace(dir))
	if err != nil {
		return nil, err
	}
	state, err := s.ensureUserSkillState(userID, skill.Dir)
	if err != nil {
		return nil, err
	}
	state.Activated = activated
	if err := s.repo.Save(state); err != nil {
		return nil, err
	}
	skill.Activated = state.Activated
	skill.Liked = state.Liked
	skill.DetailText = detailTextFromHTML(skill.DetailContent, skill.Description)
	skill.DetailContent = ""
	return skill, nil
}

func (s *Service) SetSkillLiked(ctx context.Context, userID string, dir string, liked bool) (*UpdreamSkill, error) {
	skill, err := fetchUpdreamSkillDetail(ctx, strings.TrimSpace(dir))
	if err != nil {
		return nil, err
	}
	state, err := s.ensureUserSkillState(userID, skill.Dir)
	if err != nil {
		return nil, err
	}
	state.Liked = liked
	if err := s.repo.Save(state); err != nil {
		return nil, err
	}
	skill.Activated = state.Activated
	skill.Liked = state.Liked
	skill.DetailText = detailTextFromHTML(skill.DetailContent, skill.Description)
	skill.DetailContent = ""
	return skill, nil
}

func (s *Service) ensureUserSkillState(userID string, dir string) (*model.UserSkillState, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if strings.TrimSpace(dir) == "" {
		return nil, BadAuthRequest("技能标识不能为空")
	}
	state, err := s.repo.UserSkillState(userID, dir)
	if err != nil {
		return nil, err
	}
	if state != nil {
		return state, nil
	}
	return &model.UserSkillState{ID: newID(), UserID: userID, SkillDir: dir}, nil
}

func normalizeCommunitySkillsRequest(req CommunitySkillsRequest) CommunitySkillsRequest {
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = 12
	}
	if req.PageSize > 48 {
		req.PageSize = 48
	}
	switch req.Sort {
	case "hot", "top_rated", "new":
	default:
		req.Sort = "hot"
	}
	req.Search = strings.TrimSpace(req.Search)
	req.Categories = cleanStringList(req.Categories)
	return req
}

func updreamCommunityListURL(req CommunitySkillsRequest) (string, error) {
	target, err := url.Parse(updreamSkillCommunityURL)
	if err != nil {
		return "", err
	}
	values := target.Query()
	values.Set("page", strconv.Itoa(req.Page))
	values.Set("page_size", strconv.Itoa(req.PageSize))
	values.Set("sort", req.Sort)
	if req.Search != "" {
		values.Set("search", req.Search)
	}
	for _, category := range req.Categories {
		values.Add("categories", category)
	}
	target.RawQuery = values.Encode()
	return target.String(), nil
}

func fetchUpdreamSkillDetail(ctx context.Context, dir string) (*UpdreamSkill, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, BadAuthRequest("技能标识不能为空")
	}
	var skill UpdreamSkill
	if err := fetchUpdreamJSON(ctx, updreamSkillCommunityURL+"/"+url.PathEscape(dir), &skill); err != nil {
		return nil, err
	}
	if skill.Dir == "" {
		skill.Dir = dir
	}
	return &skill, nil
}

func fetchUpdreamJSON(ctx context.Context, target string, value any) error {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "InfiniteCanvas/skills-proxy")
	resp, err := OutboundHTTPClient(12 * time.Second).Do(req)
	if err != nil {
		return fmt.Errorf("Updream 技能接口连接失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("Updream 技能接口响应读取失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Updream 技能接口返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if err := json.Unmarshal(body, value); err != nil {
		return fmt.Errorf("Updream 技能接口数据格式错误: %w", err)
	}
	return nil
}

func applyUserSkillStates(skills []UpdreamSkill, states []model.UserSkillState) {
	byDir := make(map[string]model.UserSkillState, len(states))
	for _, state := range states {
		byDir[state.SkillDir] = state
	}
	for index := range skills {
		state, ok := byDir[skills[index].Dir]
		if !ok {
			skills[index].Activated = false
			skills[index].Liked = false
			continue
		}
		skills[index].Activated = state.Activated
		skills[index].Liked = state.Liked
	}
}

func skillDirs(skills []UpdreamSkill) []string {
	dirs := make([]string, 0, len(skills))
	for _, skill := range skills {
		if strings.TrimSpace(skill.Dir) != "" {
			dirs = append(dirs, skill.Dir)
		}
	}
	return dirs
}

func detailTextFromHTML(raw string, fallback string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return strings.TrimSpace(fallback)
	}
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return strings.Join(strings.Fields(stripHTMLTags(raw)), " ")
	}
	lines := make([]string, 0, 64)
	var walk func(*html.Node, bool)
	walk = func(node *html.Node, skip bool) {
		if node == nil {
			return
		}
		nextSkip := skip || isSkippedHTMLNode(node)
		if node.Type == html.TextNode && !nextSkip {
			text := strings.Join(strings.Fields(node.Data), " ")
			if text != "" {
				lines = append(lines, text)
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, nextSkip)
		}
	}
	walk(doc, false)
	text := strings.TrimSpace(strings.Join(lines, "\n"))
	if text == "" {
		text = strings.TrimSpace(fallback)
	}
	return text
}

func isSkippedHTMLNode(node *html.Node) bool {
	if node.Type != html.ElementNode {
		return false
	}
	switch strings.ToLower(node.Data) {
	case "script", "style", "noscript", "svg", "canvas":
		return true
	default:
		return false
	}
}

func stripHTMLTags(value string) string {
	var builder strings.Builder
	inTag := false
	for _, char := range value {
		switch {
		case char == '<':
			inTag = true
		case char == '>':
			inTag = false
			builder.WriteRune(' ')
		case !inTag:
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func cleanStringList(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			item = strings.TrimSpace(item)
			if item == "" || seen[item] {
				continue
			}
			seen[item] = true
			result = append(result, item)
		}
	}
	return result
}
