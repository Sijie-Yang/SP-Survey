<div align="center">

# SP-Survey

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/SP-Survey?style=social)](https://github.com/Sijie-Yang/SP-Survey)
[![Website](https://img.shields.io/badge/🌐-sp--survey.org-blue)](https://sp-survey.org)
[![Paper](https://img.shields.io/badge/📄-Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![License](https://img.shields.io/badge/License-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)

<img src="./public/fig_introduction.png" alt="SP-Survey" width="100%">

**Open-source, self-hosted edition of SP-Survey.**  
Same survey builder and analysis tools as the hosted platform — **no login**, your own Supabase, deploy the participant site yourself (e.g. Vercel).

> Prefer zero setup? Use **[sp-survey.org](https://sp-survey.org)** (accounts, cloud storage, and live links included).

🌐 **[sp-survey.org](https://sp-survey.org)** ·
⭐ **[This repo](https://github.com/Sijie-Yang/SP-Survey)** ·
📄 **[Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514)**

<img src="./public/UAL%20Logo.jpg" alt="UAL" height="40">
&nbsp;&nbsp;
<img src="./public/DoA%20Logo.jpg" alt="DoA NUS" height="40">

</div>

---

## Hosted vs self-host

| | **[sp-survey.org](https://sp-survey.org)** | **This repo (SP-Survey)** |
|---|---|---|
| Setup | Sign up and go | Clone + local admin + your cloud |
| Login | Required | **None** — open `/admin` directly |
| Images & responses | Managed for you | Your **Supabase** (Storage + DB) |
| Participant site | Platform live link | Deploy yourself (**Vercel** recommended) |

---

## Highlights

- **No-code builder** — image choice / rating / ranking / matrix / annotation, media panels, custom skill iframes
- **AI-assisted design** — optional OpenAI / OpenRouter key in the app
- **Research templates** — Place Pulse, SPECS, thermal affordance, and more (`public/project_templates/`)
- **Supabase Storage** — upload media (or import from Hugging Face); responses in `survey_responses`
- **Deploy to Vercel** — Step 4 generates a survey-only bundle; use the **anon** key only (never `service_role`)
- **Analysis** — TrueSkill, reliability metrics, skill charts, CSV with shown-media metadata

---

## Quick start

**Prerequisites:** [Supabase](https://supabase.com) (Storage + responses). **[Vercel](https://vercel.com)** (or any static host) for the live survey. Optional: Hugging Face, OpenAI/OpenRouter.

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
cp .env.example .env          # optional port overrides
npm run dev
```

- **Admin (no login):** http://localhost:3000/admin  
- **Survey preview:** http://localhost:3000/survey  
- **Skill library:** http://localhost:3000/skills  

### Workflow

1. **Image dataset** — connect Supabase Storage (`service_role` + `anon`), upload or import media  
2. **Survey builder** — template or from scratch  
3. **Server setup** — create `survey_responses` in Supabase (SQL in Admin Step 3)  
4. **Deploy** — generate bundle → push to GitHub → deploy on **Vercel** with **anon** key only  
5. **Results** — analyze in Admin Step 5 or export CSV  

```sql
-- If Step 3 auto-create fails, run in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS survey_responses (
  id BIGSERIAL PRIMARY KEY,
  participant_id TEXT NOT NULL,
  project_id TEXT,
  responses JSONB NOT NULL,
  displayed_images JSONB,
  survey_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert" ON survey_responses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "select" ON survey_responses FOR SELECT TO anon, authenticated USING (true);
```

Make the `survey-images` Storage bucket **public**. Credentials are entered in Admin → Step 1 (not required in `.env` for local use).

---

## Cite

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

---

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — Urban Analytics Lab, NUS

Issues: [SP-Survey/issues](https://github.com/Sijie-Yang/SP-Survey/issues)
