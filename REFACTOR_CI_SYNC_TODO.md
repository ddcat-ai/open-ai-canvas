# REFACTOR_CI_SYNC - Split upstream sync from parallel image builds
- [ ] Inspect the current workflow and preserve its release behavior.
- [ ] Restructure into one sync job, parallel web/backend build jobs, and cleanup jobs.
- [ ] Validate workflow YAML and push only to the personal fork.
