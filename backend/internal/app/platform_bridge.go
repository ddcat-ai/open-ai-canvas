package app

import (
	"context"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
)

type (
	RuntimeResourcePolicy      = platform.RuntimeResourcePolicy
	RuntimeTaskPolicy          = platform.RuntimeTaskPolicy
	RuntimeRequestPolicy       = platform.RuntimeRequestPolicy
	RuntimePolicySetting       = platform.RuntimePolicySetting
	PublicRuntimePolicySetting = platform.PublicRuntimePolicySetting
	PublicRuntimeLimits        = platform.PublicRuntimeLimits
	FeatureAvailability        = platform.FeatureAvailability
	PublicFeatureAvailability  = platform.PublicFeatureAvailability
)

const (
	FeatureShortDrama            = platform.FeatureShortDrama
	FeatureTaskCenter            = platform.FeatureTaskCenter
	FeatureCredits               = platform.FeatureCredits
	FeatureCustomChannels        = platform.FeatureCustomChannels
	FeatureFrontendModels        = platform.FeatureFrontendModels
	FeaturePluginCenter          = platform.FeaturePluginCenter
	FeatureSystemPlugins         = platform.FeatureSystemPlugins
	FeatureTimelineTranscription = platform.FeatureTimelineTranscription
)

type platformHost struct {
	svc *Service
}

func (h platformHost) RequireAdmin(user *model.User) error {
	if h.svc == nil {
		return nil
	}
	return h.svc.RequireAdmin(user)
}

func (h platformHost) AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if h.svc == nil {
		return nil
	}
	return h.svc.appendAdminAudit(actor, action, targetType, targetID, summary, metadata)
}

func (h platformHost) DesktopLocalChannelsEnabled() bool {
	if h.svc == nil {
		return false
	}
	return h.svc.DesktopLocalChannelsEnabled()
}

func (h platformHost) ChannelConcurrencyLimit(channelID string) (int, error) {
	if h.svc == nil {
		return 0, nil
	}
	channel, err := h.svc.repo.SystemChannel(channelID)
	if err != nil {
		return 0, err
	}
	return channel.ConcurrencyLimit, nil
}

func (s *Service) platformDomain() *platform.Service {
	if s == nil {
		return platform.New(nil, nil, nil)
	}
	if s.platform != nil {
		return s.platform
	}
	// Tests and small embedded callers may construct Service literals instead
	// of using New. Cache the lazily-created domain so its bounded read caches
	// retain their intended lifetime and do not turn every read into a DB hit.
	s.workerRuntimeMu.Lock()
	defer s.workerRuntimeMu.Unlock()
	if s.platform == nil {
		s.platform = platform.New(s.repo, s.coordinator, platformHost{svc: s})
	}
	return s.platform
}

func (s *Service) RuntimePolicy() (RuntimePolicySetting, error) {
	return s.platformDomain().RuntimePolicy()
}

func (s *Service) runtimeConcurrencySetting() (RuntimeTaskPolicy, error) {
	return s.platformDomain().RuntimeConcurrencySetting()
}

func (s *Service) PublicRuntimeLimits() (*PublicRuntimeLimits, error) {
	return s.platformDomain().PublicRuntimeLimits()
}

func (s *Service) AdminRuntimePolicySetting(actor *model.User) (*PublicRuntimePolicySetting, error) {
	return s.platformDomain().AdminRuntimePolicySetting(actor)
}

func (s *Service) AdminSelfUseRuntimePolicy(actor *model.User) (*PublicRuntimePolicySetting, error) {
	return s.platformDomain().AdminSelfUseRuntimePolicy(actor)
}

func (s *Service) UpdateRuntimePolicySetting(actor *model.User, value RuntimePolicySetting) (*PublicRuntimePolicySetting, error) {
	return s.platformDomain().UpdateRuntimePolicySetting(actor, value)
}

func (s *Service) ResetRuntimePolicySetting(actor *model.User) (*PublicRuntimePolicySetting, error) {
	return s.platformDomain().ResetRuntimePolicySetting(actor)
}

func (s *Service) FeatureAvailability() (*PublicFeatureAvailability, error) {
	return s.platformDomain().FeatureAvailability()
}

func (s *Service) AdminFeatureAvailability(actor *model.User) (*PublicFeatureAvailability, error) {
	return s.platformDomain().AdminFeatureAvailability(actor)
}

func (s *Service) UpdateFeatureAvailability(actor *model.User, value FeatureAvailability) (*PublicFeatureAvailability, error) {
	return s.platformDomain().UpdateFeatureAvailability(actor, value)
}

func (s *Service) FeatureEnabled(feature string) (bool, error) {
	return s.platformDomain().FeatureEnabled(feature)
}

func (s *Service) RequireFeature(feature string) error {
	return s.platformDomain().RequireFeature(feature)
}

func (s *Service) AcquireChannelSlot(ctx context.Context, channelID string, fallbackScope string, ttl time.Duration) (func(), int, error) {
	return s.platformDomain().AcquireChannelSlot(ctx, channelID, fallbackScope, ttl)
}

func (s *Service) AllowRequest(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	return s.platformDomain().AllowRequest(ctx, key, limit, window)
}

func (s *Service) RequestRetryAfter(ctx context.Context, key string, window time.Duration) time.Duration {
	return s.platformDomain().RequestRetryAfter(ctx, key, window)
}

func (s *Service) AcquireCustomRelaySlot(ctx context.Context, userID string, limit int, ttl time.Duration) (func(), bool, error) {
	return s.platformDomain().AcquireCustomRelaySlot(ctx, userID, limit, ttl)
}

func (s *Service) RecordChannelResult(ctx context.Context, channelID string, failed bool) error {
	return s.platformDomain().RecordChannelResult(ctx, channelID, failed)
}

func (s *Service) Close() error {
	if s == nil || s.coordinator == nil {
		return nil
	}
	if !s.coordinator.HasRedis() {
		return nil
	}
	return s.coordinator.Redis().Close()
}

func ChannelSlotFailureDetails(err error) (string, string) {
	return platform.ChannelSlotFailureDetails(err)
}

func SanitizeAPICallPayload(data []byte, contentType string) string {
	return platform.SanitizeAPICallPayload(data, contentType)
}

func optionalJSONString(payload map[string]any, key string) (string, error) {
	return platform.OptionalJSONString(payload, key)
}

func requireJSONString(payload map[string]any, key string) (string, error) {
	return platform.RequireJSONString(payload, key)
}

func firstJSONString(payload map[string]any, keys ...string) (string, error) {
	return platform.FirstJSONString(payload, keys...)
}

func megabytes(value int64) int64 { return kernel.Megabytes(value) }
func gigabytes(value int64) int64 { return kernel.Gigabytes(value) }

func requestPayloadForLog(req *http.Request) string {
	return platform.RequestPayloadForLog(req)
}

func (s *Service) ValidateRuntime() error {
	if s == nil {
		return nil
	}
	if s.pluginRuntimeErr != nil {
		return s.pluginRuntimeErr
	}
	return s.runtimeErr
}

const (
	featureAvailabilitySettingKey = "feature_availability"
	runtimePolicySettingKey       = "runtime_policy"
)

func defaultFeatureAvailability() FeatureAvailability {
	return platform.DefaultFeatureAvailability()
}

func publicFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	return platform.ProjectFeatureAvailability(setting, value)
}

func (s *Service) withRuntimeCapabilities(result *PublicFeatureAvailability) *PublicFeatureAvailability {
	if result != nil {
		result.DesktopLocalChannelsEnabled = s.DesktopLocalChannelsEnabled()
	}
	return result
}

func selfUseRuntimePolicy() RuntimePolicySetting { return platform.SelfUseRuntimePolicy() }
func validateRuntimePolicy(value RuntimePolicySetting) error {
	return platform.ValidateRuntimePolicy(value)
}

// Keep package-local test and legacy helpers source-compatible while the
// runtime policy implementation lives in internal/platform.
func defaultRuntimePolicy() RuntimePolicySetting {
	return platform.DefaultRuntimePolicy()
}

const (
	minChannelConcurrencyLimit = platform.MinChannelConcurrencyLimit
	maxChannelConcurrencyLimit = platform.MaxChannelConcurrencyLimit
	runtimeCoordinationTimeout = platform.CoordinationTimeout
	routeCatalogVersionKey     = platform.RouteCatalogVersionKey
)
