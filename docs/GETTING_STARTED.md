# Getting started

The short version is in the [README](../README.md#run-it-yourself). This page has the rest.

## Run a study

1. **Supabase.** Create a project at [supabase.com](https://supabase.com). On the editor's **Dataset** tab, enter the project URL, anon key and `service_role` key. Upload images there, import from Hugging Face, or download street views with the street-level helper.
2. **Design.** In Studio, describe the study and let the AI write the SP-Scheme page, or drop in a page your own AI built. Or build it question by question in the classic editor.
3. **Check.** Use the preview, Researcher Practice and the local survey link, including on a phone.
4. **Host.** On the **Host** tab, run [`supabase/setup.sql`](./supabase/setup.sql) in Supabase → SQL Editor (safe to run again after updates). Release the draft, build the participant site, push it to GitHub and import it in Vercel with:
   ```text
   REACT_APP_SUPABASE_URL=https://your-project.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=your-anon-key
   ```
   Submit one test response and check it in Supabase → `survey_responses`.
5. **Share and analyze.** Copy the link or QR code on **Share** (recruitment platforms such as Prolific included). Responses appear in **Results**, with charts, AI analysis and exports.

Changes reach participants only after you release again and redeploy.

## What is included

Studio, the AI Assistant (SP-Scheme and Classic modes), image, video and audio questions, repeated trials, balanced image draws, annotation and SAM pre-annotation, custom skills, recruitment platforms, Results with AI analysis, and silicon pretests. These are the same survey and research features as [sp-survey.org](https://sp-survey.org). Only the infrastructure differs:

| | Hosted platform | SP-Survey (this repo) |
|---|---|---|
| Access | Account | No login |
| Projects | Managed | Local JSON files in `public/projects/` |
| Media and responses | Managed | Your Supabase |
| Participant site | Hosted | You deploy it (e.g. Vercel) |
| AI models | Your key or the free model | Your key |
| Templates | Full library, one click | A built-in set; the full library can be previewed and downloaded at [sp-survey.org/templates](https://sp-survey.org/templates) |

## Use with Codex, Claude Code or Cursor

While `npm run dev` is running, a local agent API (this machine only) lets a coding agent create and edit projects, validate, release and read results. Start with `GET http://localhost:3001/api/agent`, which lists every endpoint; see [AGENTS.md](./AGENTS.md). Agent reads never include credentials. Enter keys only in the SP-Survey interface, never in a chat.

## Security

- Never commit or deploy the `service_role` key. The participant site gets only the URL and anon key.
- `.env`, local projects, backups, responses and keys are ignored by Git.
- Check consent, data retention and your institution's rules before collecting data.
- Found a vulnerability? See [SECURITY.md](./SECURITY.md).

## Development

```bash
CI=true npm test -- --watchAll=false
npm run test:server
npm run build
node scripts/build-template-catalog.mjs   # rebuild the README template list from docs/templates.json
```
