package hostupdate

import "time"

type Phase string

const (
	PhaseIdle               Phase = "idle"
	PhaseChecking           Phase = "checking"
	PhaseReady              Phase = "ready"
	PhaseNoUpdate           Phase = "no_update"
	PhasePreflight          Phase = "preflight"
	PhaseBackingUp          Phase = "backing_up"
	PhasePulling            Phase = "pulling"
	PhaseDraining           Phase = "draining"
	PhaseMigrating          Phase = "migrating"
	PhaseSwitching          Phase = "switching"
	PhaseVerifying          Phase = "verifying"
	PhaseSucceeded          Phase = "succeeded"
	PhaseRollingBack        Phase = "rolling_back"
	PhaseRolledBack         Phase = "rolled_back"
	PhaseFailed             Phase = "failed"
	PhaseManualIntervention Phase = "manual_intervention"
)

func (p Phase) Active() bool {
	switch p {
	case PhaseChecking, PhasePreflight, PhaseBackingUp, PhasePulling, PhaseDraining, PhaseMigrating, PhaseSwitching, PhaseVerifying, PhaseRollingBack:
		return true
	default:
		return false
	}
}

type Release struct {
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
	Prerelease  bool      `json:"prerelease"`
}

type Check struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Status   string `json:"status"`
	Detail   string `json:"detail,omitempty"`
	Blocking bool   `json:"blocking"`
}

type Backup struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	Checksum  string    `json:"checksum"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
	Version   string    `json:"version"`
}

type LogEntry struct {
	At      time.Time `json:"at"`
	Phase   Phase     `json:"phase"`
	Message string    `json:"message"`
}

type Operation struct {
	Sources           *Sources   `json:"sources,omitempty"`
	ID                string     `json:"id,omitempty"`
	Phase             Phase      `json:"phase"`
	FromVersion       string     `json:"fromVersion,omitempty"`
	TargetVersion     string     `json:"targetVersion,omitempty"`
	StartedAt         *time.Time `json:"startedAt,omitempty"`
	FinishedAt        *time.Time `json:"finishedAt,omitempty"`
	Error             string     `json:"error,omitempty"`
	RollbackError     string     `json:"rollbackError,omitempty"`
	AutomaticRollback bool       `json:"automaticRollback"`
	Logs              []LogEntry `json:"logs"`
}

type Status struct {
	Sources         *Sources     `json:"sources,omitempty"`
	SourceProbe     *SourceProbe `json:"sourceProbe,omitempty"`
	Supported       bool         `json:"supported"`
	Connected       bool         `json:"connected"`
	Repository      string       `json:"repository"`
	Deployment      string       `json:"deployment"`
	CurrentVersion  string       `json:"currentVersion"`
	LatestRelease   *Release     `json:"latestRelease,omitempty"`
	UpdateAvailable bool         `json:"updateAvailable"`
	Checks          []Check      `json:"checks"`
	LastBackup      *Backup      `json:"lastBackup,omitempty"`
	RollbackVersion string       `json:"rollbackVersion,omitempty"`
	Operation       Operation    `json:"operation"`
}

type Sources struct {
	GitHubSource string `json:"githubSource"`
	ImageSource  string `json:"imageSource"`
}

type SourceProbe struct {
	ID            string     `json:"id"`
	Status        string     `json:"status"`
	Sources       Sources    `json:"sources"`
	TargetVersion string     `json:"targetVersion,omitempty"`
	Checks        []Check    `json:"checks"`
	StartedAt     time.Time  `json:"startedAt"`
	FinishedAt    *time.Time `json:"finishedAt,omitempty"`
}

type StartRequest struct {
	TargetVersion string `json:"targetVersion"`
}

type RollbackRequest struct {
	Reason string `json:"reason"`
}
