package app

import (
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/repository"
)

func cloudAgentToolHandlers() map[string]cloudAgentToolHandler {
	return map[string]cloudAgentToolHandler{
		agenttool.AgentProfileRead:       {Read: cloudAgentHandleAgentProfileRead},
		agenttool.PlanUpdate:             {Read: cloudAgentHandlePlanUpdate},
		agenttool.AskUser:                {Read: cloudAgentHandleAskUser},
		agenttool.PrevisSceneRead:        {Read: cloudAgentHandlePrevisSceneRead},
		agenttool.PrevisPreview:          {Read: cloudAgentHandlePrevisPreview},
		agenttool.PrevisSceneCreate:      {Write: applyCloudAgentPrevisMutation, Preview: cloudAgentPreviewPrevisCreate},
		agenttool.PrevisApplyPatch:       {Write: applyCloudAgentPrevisMutation, Preview: cloudAgentPreviewPrevisPatch},
		agenttool.CanvasListNodeTypes:    {Read: cloudAgentHandleCanvasListNodeTypes},
		agenttool.CanvasGetState:         {Read: cloudAgentHandleCanvasGetState},
		agenttool.CanvasReadText:         {Read: cloudAgentHandleCanvasReadText},
		agenttool.CanvasReadBatchTable:   {Read: cloudAgentHandleCanvasReadBatchTable},
		agenttool.CanvasReadStoryboard:   {Read: cloudAgentHandleCanvasReadStoryboard},
		agenttool.ImageTextDetect:        {Read: cloudAgentHandleImageTextDetect},
		agenttool.ImageAnnotationRender:  {Read: cloudAgentHandleImageAnnotationRender},
		agenttool.SkillReadFile:          {Read: cloudAgentHandleSkillReadFile},
		agenttool.SkillSearch:            {Read: cloudAgentHandleSkillSearch},
		agenttool.SkillMarketSearch:      {Read: cloudAgentHandleSkillMarketSearch},
		agenttool.SkillRecommend:         {Read: cloudAgentHandleSkillRecommend},
		agenttool.TaskGet:                {Read: cloudAgentHandleTaskGet},
		agenttool.CanvasInspectImage:     {Pipeline: cloudAgentToolVision},
		agenttool.MemoryUpdate:           {Read: cloudAgentHandleMemoryUpdate},
		agenttool.ImageLayerSplit:        {Pipeline: cloudAgentToolMedia},
		agenttool.ModelList:              {Read: cloudAgentHandleModelList},
		agenttool.CanvasCreateStoryboard: {Write: applyCloudAgentStoryboardMutation, Preview: cloudAgentPreviewStoryboardCreate},
		agenttool.CanvasEditStoryboard:   {Write: applyCloudAgentStoryboardMutation, Preview: cloudAgentPreviewStoryboardEdit},
		agenttool.CanvasCreateCharacter:  {Write: applyCloudAgentCharacterCreate, Preview: cloudAgentPreviewCharacterCreate},
		agenttool.CanvasEditBatchTable:   {Write: applyCloudAgentBatchTableMutation, Preview: cloudAgentPreviewBatchTable},
		agenttool.CanvasApplyOps:         {Write: applyCloudAgentCanvas, Preview: cloudAgentPreviewCanvas},
		agenttool.CanvasArrangeNodes:     {Write: applyCloudAgentArrangeNodes, Preview: cloudAgentPreviewArrange},
		agenttool.GenerateMedia:          {Pipeline: cloudAgentToolMedia},
		agenttool.DramaGetContext:        {Read: cloudAgentHandleDramaGetContext},
		agenttool.DramaAdoptCanvasMedia:  {Write: applyCloudAgentDramaAdopt, Preview: cloudAgentPreviewDramaAdopt},
	}
}

func cloudAgentPreviewCanvas(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentCanvasMutation(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewArrange(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentArrangeNodes(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewStoryboardCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentStoryboardCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewStoryboardEdit(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentStoryboardEdit(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewCharacterCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentCharacterCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewBatchTable(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentBatchTableEdit(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewPrevisCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentPrevisSceneCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewPrevisPatch(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentPrevisApplyPatch(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}
