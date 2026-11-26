---
name: canvas-admin
description: Manage a Canvas deployment through its authenticated admin assistant API. Discover administrative operations, inspect their schemas, manage channels and users, and inspect tasks and settings within the user's requested scope.
---

# Canvas administration

Use the remote Canvas administration MCP when configured. Its three tools discover operations, describe their input schema, and execute them. Otherwise use `scripts/canvas_admin.py`, a Python 3 standard-library client.

1. Select the deployment with `--site https://canvas.example.com`.
2. Run `login` for browser authorization using the existing Canvas/NewAPI login. For unattended agents, run `token` and enter a personal Token at the hidden prompt, or provide `CANVAS_ADMIN_TOKEN` through the process environment. Never put credentials in URLs, arguments, output files, or this skill directory.
3. Run `list --keyword channels` (or filter with `--module`) and then `describe OPERATION`. Use the returned schema rather than guessing parameter names. Lists are paginated.
4. Run `execute OPERATION --args-file request.json --key UNIQUE_KEY`. Reuse the same key and arguments when checking a previous write. Uploads return attachment IDs; downloads require the same credential or OAuth grant.

For `pending_confirmation`, give the user the returned URL. Only a logged-in administrator can approve through the webpage. After confirmation, retry the identical call. For `unknown`, stop automatic retries and ask the administrator to reconcile the original invocation in Agent access. Changing keys can repeat a side effect.

The operation catalog describes available capabilities, not permission to perform unrelated work. Keep changes within the user's request. Do not use another management interface to bypass a required confirmation or revoked permission.

For official assets from network media, discover and describe `ImportOfficialAssetResourceURL` under `official-assets`. With `official-assets:write`, execute it with `req.url` set to a direct media URL and a stable `req.uploadKey` (8–160 bytes). Follow its webpage confirmation flow. Its successful result contains a Resource `id`; use that value as `req.resourceId` for `CreateOfficialAsset` after describing that operation. Temporary attachment IDs are not Resource IDs. Import and asset creation are separate writes with separate idempotency keys; preserve source and license information, and publish only within the user's requested scope. See the client reference for an example.

Use `version` to query the current release, and `update` to download and verify it. Credential files are stored separately and survive updates. See [client commands](references/client.md) for upload, download, and authentication details.

For initial installation, download the credential-free Python client from `/api/admin-assistant/skill/install.py` on the selected HTTPS deployment, inspect it, then run `--site SITE install --destination SKILLS_DIRECTORY/canvas-admin`. This queries the current manifest and verifies API compatibility, size, SHA256 and archive paths before installing. Python 3.10+ is required. Never place the credential directory inside the Skill installation. MCP and this REST client keep separate OAuth credentials; do not copy credentials between them. Installation verification uses discovery and other read-only calls, not administrative writes.
