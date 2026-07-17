<div align="center">

# SP-Survey

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/SP-Survey?style=social)](https://github.com/Sijie-Yang/SP-Survey)
[![Website](https://img.shields.io/badge/🌐-sp--survey.org-blue)](https://sp-survey.org)
[![Paper](https://img.shields.io/badge/📄-Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![License](https://img.shields.io/badge/License-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)

<img src="./public/fig_introduction.png" alt="SP-Survey" width="100%">

**Build research-grade visual surveys with a UI, or design them together with Codex and other IDE agents.**

Open-source and self-hosted: no login, local project files, your own Supabase, and your own participant deployment.

> Want managed accounts, storage, and live links? Use **[sp-survey.org](https://sp-survey.org)**.

🌐 **[Hosted platform](https://sp-survey.org)** ·
⭐ **[Open-source repository](https://github.com/Sijie-Yang/SP-Survey)** ·
📄 **[Research paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514)**

</div>

---

## Why use SP-Survey if an AI can code a survey?

AI coding tools are excellent at producing a form. The difficult part is keeping the entire research workflow correct after the first prompt.

SP-Survey gives an AI-generated survey a stable system around it:

- a visual builder for researchers who do not want to edit code;
- reusable, validated question types instead of one-off UI components;
- the same theme and participant widgets in question preview, survey preview, and Live Survey;
- reproducible media assignment with folders, fixed sets, categories, and multi-trial questions;
- participant progress, draft/resume, completion codes, quotas, and response metadata;
- Researcher Practice before data collection;
- shown-media and trial metadata preserved with responses;
- analysis and export designed for perception research;
- a deployment boundary that keeps admin credentials out of the participant bundle.

Use Codex, Cursor, VS Code Copilot, Claude Code, or another IDE agent to propose and edit the survey. Use SP-Survey to inspect, interact with, test, run, and analyze it.

```text
Research brief → AI/IDE edits survey JSON → SP-Survey visual validation
               → Researcher Practice → Live Survey → responses + analysis
```

---

## Hosted platform vs this repository

| | **[sp-survey.org](https://sp-survey.org)** | **This repository** |
|---|---|---|
| Setup | Sign up and start | Clone and run locally |
| Login | Required | **No login** — open `/admin` |
| Project management | Multi-user hosted projects | Local JSON project files |
| Media and responses | Managed cloud infrastructure | Your **Supabase** Storage and database |
| Participant survey | Hosted live link | Build and deploy it yourself |
| Survey/research features | Included | Intended to match the hosted platform |

The product difference is hosting and data ownership—not a reduced survey builder.

---

## What you can build

- Standard questions: text, comment, number, consent, dropdown, radio, checkbox, boolean, rating, ranking, and matrix.
- Visual questions: image/media choice, rating, ranking, boolean, matrix, annotation, and custom skill iframes.
- Experimental designs: random media, curated media, fixed folder sets, per-category sampling, exclusion across questions, and repeated trials.
- Media workflow: your Supabase configuration, direct upload, Hugging Face import, folders, set/category tags, spatial features, and SAM3 pre-annotation.
- Survey experience: theme presets, unified previews, progress chrome, mobile layouts, draft/resume, response quotas, and completion messages.
- Research workflow: templates, researcher practice, response quality checks, TrueSkill/forced-choice analysis, reliability metrics, perception joins, ablation, and CSV export.

Research templates are stored in [`public/project_templates/`](./public/project_templates/).

---

## Quick start

### Requirements

- Node.js 18 or newer
- npm
- A Supabase project when you are ready to upload media or collect responses
- Optional: Hugging Face, OpenAI/OpenRouter, and fal.ai credentials

### Run locally

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
npm run dev
```

With no port overrides:

- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Participant survey: [http://localhost:3000/survey](http://localhost:3000/survey)
- Skill library: [http://localhost:3000/skills](http://localhost:3000/skills)
- Local API: `http://localhost:3001`

For custom ports, copy [`.env.example`](./.env.example) and follow its comments. The React client can use `.env.local` with `REACT_APP_API_URL` pointing to the local API.

### Normal workflow

1. **Media Dataset** — connect your Supabase project, upload/import media, organize folders, and optionally tag folders as sets or categories.
2. **Survey Builder** — start from a research template or create a survey from scratch.
3. **Server Setup** — create and check the `survey_responses` table.
4. **Website Deployment** — generate the participant-only bundle and deploy it.
5. **Results Analysis** — inspect quality, analyze results, and export data.

Before deployment, use **Researcher Practice**, the full **Preview Survey**, and **View Live Survey**. They exercise different parts of the workflow and should all be checked.

---

## Design surveys with Codex or another IDE agent

SP-Survey supports a safe round trip between the visual application and an AI coding environment.

### Recommended: credential-free export and import

1. Create or open a project in SP-Survey.
2. In the project menu, select **Export for AI / IDE**.
3. Give the downloaded `*-for-ai.json` file and your research brief to your IDE agent.
4. Ask the agent to edit `surveyConfig` while keeping the `project` and `surveyConfig` root objects intact.
5. In SP-Survey, click **Import Project** and select the edited JSON.
6. Inspect non-blocking survey checks, question previews, the full preview, Researcher Practice, and Live Survey.
7. Configure Supabase and deployment credentials inside SP-Survey; do not ask the agent to add them to the JSON.

The AI/IDE export recursively removes known Supabase, Hugging Face, fal.ai, OpenAI/OpenRouter, password, token, and API-key fields. A normal **Export Project** is a backup and may contain credentials; do not use that file for AI collaboration or public issues.

### Example prompt: create a study

```text
Edit the attached SP-Survey AI/IDE export.

Study goal: compare perceived safety and visual comfort for 40 street images.
Design: each participant sees 10 randomly selected images, one image per trial.
Measures: safety (1–7), visual comfort (1–7), and one optional comment.
Requirements:
- include consent and brief demographics;
- use stable, descriptive question names;
- avoid leading wording and double-barrelled questions;
- preserve the project and surveyConfig root objects;
- do not add credentials or application code;
- return a valid importable JSON file and summarize the design decisions.
```

### Example prompt: review an existing study

```text
Review and revise this SP-Survey export as a survey-methods expert.

Check construct coverage, ordering effects, required questions, scale anchors,
randomization, participant burden, mobile usability, and whether media/trial
metadata will support the planned analysis. Make only justified edits to
surveyConfig. Keep existing question names when changing them would break
longitudinal compatibility. Do not add secrets.
```

### Example prompt: implement a new interaction

When the existing question types are insufficient, an IDE agent can extend the application itself:

```text
Add a participant interaction to SP-Survey, not to SP-Survey-Platform.
Reuse the existing SurveyJS custom-widget registration, trial navigation,
theme application, response enrichment, question preview, full preview, and
Live Survey paths. The interaction must behave consistently in all previews,
support mobile layouts, preserve response metadata, and include tests.
Do not introduce login, Cloudflare R2, or hosted-platform dependencies.
```

Useful implementation locations:

| Purpose | Location |
|---|---|
| Local project API and deployment generation | `server.js`, `src/lib/deploymentManager.js` |
| Survey builder and question editor | `src/components/admin/SurveyBuilder.js`, `QuestionEditor.js` |
| Participant widgets | `src/components/SurveyCustomComponents.js`, `src/components/*Widget.js` |
| Question/full/live previews | `QuestionParticipantPreview.js`, `SurveyPreview.js`, `src/SurveyApp.js` |
| Media assignment and repeated trials | `src/lib/surveyMediaInjection.js`, `src/lib/trialNavigation.js` |
| Theme consistency | `src/lib/surveyStorage.js`, `SurveyThemePreviewPanel.js` |
| Response metadata and exports | `src/lib/enrichSurveyResponses.js`, `src/components/admin/ResultsAnalysis.js` |
| Local project files | `public/projects/` |

### The verification loop

Do not accept an AI-generated JSON or code change only because it parses.

```bash
npm test -- --watchAll=false
npm run build
```

Then verify in the browser:

- the question-setting preview;
- Theme Settings preview;
- the complete Preview Survey dialog;
- Researcher Practice for media/annotation studies;
- `/survey?project=<project-id>` as a participant;
- at least one mobile-width layout;
- the exported response fields needed by the analysis plan.

---

## Application AI Assistant

The Survey Builder also includes an optional conversational assistant. Enter an OpenAI or OpenRouter key in its settings to draft or revise a survey without leaving the application.

Use the in-app assistant for quick question and structure changes. Use an IDE agent when you want file-based review, larger JSON transformations, tests, a new question interaction, or a contribution to SP-Survey itself.

API credentials entered for AI services remain your responsibility. Never commit keys to the repository.

---

## Supabase setup

In **Admin → Step 1 → Supabase Storage**, enter:

- Project ID/URL
- `service_role` key for local administrator uploads only
- `anon` key for the deployed participant survey

Create a public Storage bucket named `survey-images`. The application can attempt to create it on first upload, but you should verify that it is public and that browser CORS works.

Create the response table from **Admin → Step 3**, or run:

```sql
CREATE TABLE IF NOT EXISTS survey_responses (
  id BIGSERIAL PRIMARY KEY,
  participant_id TEXT NOT NULL,
  project_id TEXT,
  responses JSONB NOT NULL,
  displayed_images JSONB,
  survey_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_created_at
ON survey_responses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_responses_participant_id
ON survey_responses(participant_id);

CREATE INDEX IF NOT EXISTS idx_survey_responses_project_id
ON survey_responses(project_id);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous inserts to survey_responses" ON survey_responses;
CREATE POLICY "Allow anonymous inserts to survey_responses"
ON survey_responses FOR INSERT TO anon, authenticated
WITH CHECK (true);
```

Grant only the policies your deployment needs. Anonymous participant submission normally needs `INSERT`; public `SELECT` is not required for a participant-facing survey and should not be enabled unless you intentionally want public reads.

For a deployed survey, expose only:

```text
REACT_APP_SUPABASE_URL
REACT_APP_SUPABASE_ANON_KEY
```

Never deploy or commit the `service_role` key.

---

## Local data and security

- Local projects are stored as JSON under `public/projects/`.
- A regular project backup can contain Supabase configuration. Treat it as sensitive.
- Use **Export for AI / IDE** for agent collaboration, examples, bug reports, and external review.
- `.env`, `.env.local`, project backups, response exports, and participant data should not be committed.
- The generated participant deployment must use the Supabase anon key, never the administrator service key.
- Review consent, retention, access control, and institutional requirements for your own study.

---

## Contributing

Issues and pull requests are welcome: [Sijie-Yang/SP-Survey/issues](https://github.com/Sijie-Yang/SP-Survey/issues).

For changes to survey interactions, include the complete path rather than only the editor control:

1. builder/editor configuration;
2. question preview;
3. full survey preview;
4. participant Live Survey;
5. response serialization and metadata;
6. analysis/export compatibility;
7. tests and production build.

Keep self-hosted boundaries intact: SP-Survey has no login, stores local projects as files, uses user-configured Supabase, and generates an independently deployed participant site.

---

## Citation

```bibtex
@article{yang2025thermal,
  title={Thermal comfort in sight: Thermal affordance and its visual assessment for sustainable streetscape design},
  author={Yang, Sijie and Chong, Adrian and Liu, Pengyuan and Biljecki, Filip},
  journal={Building and Environment},
  pages={112569},
  year={2025},
  publisher={Elsevier}
}
```

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — Urban Analytics Lab, National University of Singapore.
