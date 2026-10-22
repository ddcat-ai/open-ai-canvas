# MaxForAI Video

MaxForAI video generation protocol for the documented unified fields. The package provides both `POST /v1/videos` and `POST /v1/video/generations` as separate provider profiles.

Only public HTTPS media URLs are accepted by the upstream. Existing platform or customer URLs are passed through; this plugin does not upload media.

The full request and response contract is in [docs/interface.md](docs/interface.md).
