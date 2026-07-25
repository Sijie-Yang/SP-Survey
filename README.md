<div align="center">

# SP-Survey

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/SP-Survey?style=social)](https://github.com/Sijie-Yang/SP-Survey)
[![Website](https://img.shields.io/badge/🌐-sp--survey.org-blue)](https://sp-survey.org)
[![Paper](https://img.shields.io/badge/📄-Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![License](https://img.shields.io/badge/License-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)

<img src="./public/fig_introduction.png" alt="SP-Survey" width="100%">

Visual survey design, media experiments, participant deployment, and research analysis in one self-hosted application.

**No login · Local project files · Your Supabase · Your deployment**

[Hosted platform](https://sp-survey.org) · [Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514) · [Issues](https://github.com/Sijie-Yang/SP-Survey/issues)

</div>

## Features

- Standard, image, ranking, matrix, annotation, and custom-skill questions.
- Random media, curated media, fixed sets, categories, and repeated trials.
- SAM pre-annotate (click / box / text), batch SAM Text, label manager, review queue, and ZIP / feature CSV downloads.
- Select-mode geometry editing for points, lines, polygons, and boxes.
- Typed custom Skills with native-parity analysis/export.
- Supabase/Hugging Face media workflows and advanced research analysis.
- Unified theme behavior across question preview, full preview, Researcher Practice, and Live Survey.
- Response quality checks, reliability, TrueSkill, perception analysis, ablation, and CSV export.
- Participant-only deployment with response and shown-media metadata.

The hosted Platform and this repository share survey/research features. The difference is infrastructure:

| | Hosted Platform | SP-Survey |
|---|---|---|
| Access | Account and managed projects | No login; open `/admin` |
| Storage | Managed | Local project JSON + your Supabase |
| Participant site | Hosted | Deploy it yourself |

## Quick start

Requirements: Node.js 18+ and npm.

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
npm run dev
```

- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Local Live Survey: [http://localhost:3000/survey](http://localhost:3000/survey)
- Local API: `http://localhost:3001`

Use [`.env.example`](./.env.example) for custom ports. Supabase is optional until media upload or response collection.

## Use SP-Survey directly with Codex

Open the SP-Survey folder in Codex and describe the study. Codex can create, read, and update local projects directly; export/import is not required.

```text
Open my current streetscape project. Give each participant 10 random images,
ask safety and visual-comfort ratings from 1–7, then run the checks and open
the local Live Survey for me to review. Preserve my media and Supabase settings.
```

The localhost-only agent API is available while `npm run dev` is running:

| Action | Endpoint |
|---|---|
| Discover the API | `GET /api/agent` |
| Create a project | `POST /api/agent/projects` |
| List projects | `GET /api/agent/projects` |
| Read a project | `GET /api/agent/projects/:id` |
| Update `surveyConfig` | `PATCH /api/agent/projects/:id/survey` |
| Validate | `POST /api/agent/projects/:id/validate` |
| Get preview URLs | `GET /api/agent/projects/:id/preview-url` |

Agent reads exclude known credentials. Updates change only `surveyConfig`, preserve stored credentials, create a local backup, and reject invalid structure. Send the returned `savedAt` as `expectedSavedAt` when updating to prevent overwriting a newer edit.

After every change, check:

1. Question preview and Theme Settings preview.
2. Full Preview Survey.
3. Researcher Practice for media or annotation studies.
4. Local Live Survey, including mobile width.
5. Response fields required by the analysis plan.

`Export for AI / IDE` remains available for sharing a credential-free project outside the local workspace.

## Complete survey workflow

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com). In **Project Settings → API**, copy:

- Project ID or Project URL;
- anon key for the participant website;
- `service_role` key for local administrator uploads and analysis.

Do not give keys to Codex. Enter them only in the SP-Survey interface.

### 2. Create the local SP-Survey project

Run `npm run dev`, then create a project in `/admin` or ask Codex to create one through the local agent API. Projects are local JSON files under `public/projects/` and are not committed.

Codex can create, review, and update the selected survey directly through the local agent API. If several projects have similar names, identify the intended project before asking Codex to edit it.

### 3. Configure Supabase and upload media

Open **Step 1 - Media Dataset**. The top row has three panels:

1. **Supabase Storage** — enter Project ID, anon key, and `service_role` key; click **Save**, then **Test**.
2. **Upload Media** — choose local images, video, or audio and upload them to Supabase Storage.
3. **HF Dataset Import** — import a Hugging Face dataset and transfer its media to Supabase.

In Supabase **Storage**, create a public bucket named `survey-images`. SP-Survey can also attempt to create it on the first upload. Confirm that uploaded files appear in the Media Library, then organize folders and mark folders as sets or categories when required.

Codex can configure media assignment, folders, repeated trials, and question logic. The user should enter credentials and select private local files.

### 4. Design the survey

Open **Step 2 - Survey Builder**. Create pages and questions, configure media assignment, repeated trials, validation, progress, theme, completion text, and response metadata.

This is the main Codex step. Describe the study in natural language; Codex reads the current local project, updates `surveyConfig`, validates it, and returns the local Admin and Local Live Survey URLs. Use the visual editor for manual adjustments.

### 5. Preview and practice

Check the question preview, Theme Settings preview, full **Preview Survey**, **Researcher Practice**, and local **View Live Survey**. Test mobile width and confirm that media, trial navigation, required questions, theme, and saved metadata agree in every view. This localhost page is a preview; the public participant link is created in Step 7.

### 6. Create the Supabase response table

Open **Step 3 - Server Setup**. It uses the Supabase configuration saved in Step 1. Click **Copy SQL Script**, open **Supabase Dashboard → SQL Editor**, paste the following SQL, and click **Run**:

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

DROP POLICY IF EXISTS "Allow anonymous inserts to survey_responses"
ON survey_responses;

CREATE POLICY "Allow anonymous inserts to survey_responses"
ON survey_responses
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

GRANT INSERT ON TABLE survey_responses TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE survey_responses_id_seq TO anon, authenticated;

DROP POLICY IF EXISTS "Allow public read survey_responses"
ON survey_responses;

REVOKE SELECT ON TABLE survey_responses FROM anon, authenticated;
```

Return to SP-Survey, check the connection and table status, then submit a test response. Participants can insert responses; anonymous users cannot read all responses. The local administrator uses the `service_role` key for Results Analysis.

### 7. Generate and deploy the participant website

Open **Step 4 - Website Deployment**:

1. Click **Prepare Deployment Folder**.
2. Click **Test Build** and open the generated preview.
3. Create an empty GitHub repository for this participant deployment.
4. Enter that repository URL and click **Upload to GitHub**, or push the generated folder manually.
5. In Vercel, create a project by importing that GitHub repository.
6. In **Vercel Project Settings → Environment Variables**, add:

```text
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

Do not add the `service_role` key to GitHub or Vercel. Deploy or redeploy after saving the environment variables.

Open the deployed `/survey` page, complete the survey once, and confirm the new row in **Supabase → Table Editor → survey_responses**. Test the final participant URL before distributing it.

### 8. Analyze responses

Return to **Results Analysis** in the local Admin application. Use the locally stored `service_role` configuration to load responses, inspect quality and researcher-practice records, run the required analyses, and export CSV files.

Templates are stored in [`public/project_templates/`](./public/project_templates/). `Export for AI / IDE` is only for sharing a credential-free project outside the local workspace.

## Security

- Never commit or deploy the `service_role` key.
- The participant website receives only the Supabase URL and anon key.
- `.env`, local projects, backups, responses, and participant data are ignored by Git.
- Review consent, retention, access control, and institutional requirements before data collection.

## Development

```bash
CI=true npm test -- --watchAll=false --runInBand
npm run build
```

Changes to participant interactions must cover the builder, question preview, full preview, Researcher Practice, Live Survey, response metadata, analysis/export, and tests. Keep the self-hosted boundary: no login, no Platform project ownership, no managed R2 dependency.

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
