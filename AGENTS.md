# SP-Survey agent guide

## New surveys: use the kit with your own AI (default)

For any request to build, run or analyse a survey, follow `.claude/skills/sp-survey/SKILL.md` (Codex: read it now; Claude Code loads it as a skill). In short:

- Read `kit/SP-SCHEME.md`; start from `node kit/sp.mjs templates` / `node kit/sp.mjs new <folder> --template <id>` when a template fits.
- Never re-implement randomisation, answer checks or storage: `kit/sp-site.js` does them. Never hard-code or generate stimulus images.
- `node kit/sp.mjs check <folder>` must show no ✗; `node kit/sp.mjs serve <folder>` and click through at phone and desktop width before handing over.
- Never ask for, print or store credentials. `sp-config.json` holds only the Supabase URL and anon key; the service-role key is set by the researcher in their own shell for `export`.
- Changes to `kit/`: run `node --test kit/kit.test.mjs`.

## Classic app (only when the user works in /admin)

Work only in SP-Survey. SP-Survey-Platform is a reference, not the edit target.

## Survey project changes

- Prefer the local agent API; do not ask the user to export/import a project unless they are sharing it outside this workspace.
- Start the app with `npm run dev` when needed.
- Create a new project with `POST http://localhost:3001/api/agent/projects` when the user requests one; do not include credentials.
- Discover projects through the localhost-only API: `GET http://localhost:3001/api/agent/projects`.
- If the requested project is ambiguous, ask before editing.
- Always `GET /api/agent/capabilities` then `GET /api/agent/projects/:id` (retain `savedAt` / `draftUpdatedAt`).
- Prefer `POST /api/agent/projects/:id/operations` over full `PATCH .../survey` replace.
- Media: `GET|PATCH /api/agent/projects/:id/media` for folder tags / dataset notes. Templates create projects without media; users upload files or import from Hugging Face. Never AI-generate images.
- Skills: `GET /api/agent/skills` and `POST /api/agent/skills` with one typed `resultSchema` field. HTML must call `SPSkill.setAnswer(object)`.
- Results: `GET /api/agent/projects/:id/results` describes where to read the researcher's own Supabase / local files. Do not expect hosted MCP result dumps.
- Release: `POST /api/agent/projects/:id/release` with `confirm: true` updates the local participant snapshot. The user deploys the participant site from the Host tab (部署) and can save the public URL there. Share (分享) is only for the link, QR code, and pre-launch try-run.
- Never request, print, add, or change credentials. The API intentionally excludes them.
- Run validation and inspect the returned local Admin and Local Live Survey URLs after an update.

## Application changes

- Preserve the self-hosted architecture: no login, local project JSON, user-configured Supabase, independently deployed participant site.
- Keep question preview, full preview, Researcher Practice, and Live Survey behavior consistent.
- Preserve response and shown-media metadata needed by analysis/export.
- Run the relevant tests, the full test suite, and the production build.
