# SP-Survey agent workflow

Work only in SP-Survey. SP-Survey-Platform is a reference, not the edit target.

## Survey project changes

- Prefer the local agent API; do not ask the user to export/import a project unless they are sharing it outside this workspace.
- Start the app with `npm run dev` when needed.
- Create a new project with `POST http://localhost:3001/api/agent/projects` when the user requests one; do not include credentials.
- Discover projects through the localhost-only API: `GET http://localhost:3001/api/agent/projects`.
- If the requested project is ambiguous, ask before editing.
- Always `GET /api/agent/capabilities` then `GET /api/agent/projects/:id` (retain `savedAt` / `draftUpdatedAt`).
- Prefer `POST /api/agent/projects/:id/operations` over full `PATCH .../survey` replace.
- Media: `GET|PATCH /api/agent/projects/:id/media` for folder tags / dataset notes. Never AI-generate images.
- Skills: `GET /api/agent/skills` and `POST /api/agent/skills` with one typed `resultSchema` field. HTML must call `SPSkill.setAnswer(object)`.
- Results: `GET /api/agent/projects/:id/results` describes where to read the researcher's own Supabase / local files. Do not expect hosted MCP result dumps.
- Release: `POST /api/agent/projects/:id/release` with `confirm: true` updates the local participant snapshot. The user still deploys the participant site themselves.
- Never request, print, add, or change credentials. The API intentionally excludes them.
- Run validation and inspect the returned local Admin and Local Live Survey URLs after an update.

## Application changes

- Preserve the self-hosted architecture: no login, local project JSON, user-configured Supabase, independently deployed participant site.
- Keep question preview, full preview, Researcher Practice, and Live Survey behavior consistent.
- Preserve response and shown-media metadata needed by analysis/export.
- Run the relevant tests, the full test suite, and the production build.
