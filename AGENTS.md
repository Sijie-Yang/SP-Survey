# SP-Survey agent workflow

Work only in SP-Survey. SP-Survey-Platform is a reference, not the edit target.

## Survey project changes

- Prefer the local agent API; do not ask the user to export/import a project unless they are sharing it outside this workspace.
- Start the app with `npm run dev` when needed.
- Create a new project with `POST http://localhost:3001/api/agent/projects` when the user requests one; do not include credentials.
- Discover projects through the localhost-only API: `GET http://localhost:3001/api/agent/projects`.
- If the requested project is ambiguous, ask before editing.
- Read it with `GET /api/agent/projects/:id`; retain its `savedAt` value.
- Update only through `PATCH /api/agent/projects/:id/survey` with `surveyConfig` and `expectedSavedAt`.
- Never request, print, add, or change credentials. The API intentionally excludes them.
- Run validation and inspect the returned local Admin and Local Live Survey URLs after an update.

## Application changes

- Preserve the self-hosted architecture: no login, local project JSON, user-configured Supabase, independently deployed participant site.
- Keep question preview, full preview, Researcher Practice, and Live Survey behavior consistent.
- Preserve response and shown-media metadata needed by analysis/export.
- Run the relevant tests, the full test suite, and the production build.
