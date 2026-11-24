package service

import "yingce/backend/internal/app"

type AssistantPrincipal = app.AssistantPrincipal
type AssistantTokenRequest = app.AssistantTokenRequest
type AssistantOAuthRequest = app.AssistantOAuthRequest
type AssistantOAuthTokenRequest = app.AssistantOAuthTokenRequest
type AssistantExecuteRequest = app.AssistantExecuteRequest
type AssistantExecution = app.AssistantExecution

const AssistantAPIPath = app.AssistantAPIPath
const AssistantAttachmentLimit = app.AssistantAttachmentLimit

var AssistantBaseURL = app.AssistantBaseURL
var AssistantResource = app.AssistantResource
var AssistantSkillPackage = app.AssistantSkillPackage
