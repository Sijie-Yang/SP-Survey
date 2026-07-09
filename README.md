<div align="center">

# 🏙️ SP-Survey (Streetscape Perception Survey)

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/Streetscape-Perception-Survey?style=social)](https://github.com/Sijie-Yang/Streetscape-Perception-Survey)
[![SP-Survey.org](https://img.shields.io/badge/🚀_Use_Online-SP--Survey.org-FF6B35?style=for-the-badge)](https://sp-survey.org)
[![Paper](https://img.shields.io/badge/📄-Published_Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![Website](https://img.shields.io/badge/🌐-Live_Demo-blue)](https://streetscape-perception-survey.vercel.app/)
[![License](https://img.shields.io/badge/📄-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js)](https://nodejs.org/)


<img src="./public/fig_introduction.png" alt="SP-Survey Interface" width="100%">

<strong>A professional, research-grade platform for conducting visual perception surveys.</strong>
<br>
Self-hosted local edition of <a href="https://sp-survey.org">SP-Survey-Platform</a> — same survey features, no login required. Build surveys with drag-and-drop, AI generation, skill questions, and deploy to your own Supabase + Vercel.

> ### ⚡ Don't want to self-host? Use the online platform
>
> **Most users don't need to clone this repo.** Go to **[sp-survey.org](https://sp-survey.org), sign up, and you're ready — upload images, build surveys, share links, and collect responses, all in your browser.
>
> 👉 **[Use SP-Survey.org now →](https://sp-survey.org)**
>
> *This repo (SP-Survey) is for researchers who need local self-hosting, a login-free admin panel, or their own Supabase + Vercel deployment.*

🌐 <a href="https://sp-survey.org"><strong>SP-Survey.org (online — recommended)</strong></a> •
🌐 <a href="https://streetscape-perception-survey.vercel.app/"><strong>Live Demo</strong></a> •
📄 <a href="https://www.sciencedirect.com/science/article/pii/S0360132325000514"><strong>Research Paper</strong></a> •
🔗 <a href="https://thermal-affordance.ual.sg"><strong>Project Website</strong></a> •
📊 <a href="https://github.com/Sijie-Yang/Thermal-Affordance"><strong>Dataset</strong></a>

<img src="./public/UAL Logo.jpg" alt="Urban Analytics Lab" height="50">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./public/DoA Logo.jpg" alt="Department of Architecture NUS" height="50">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="./public/logo-long.png" alt="SP-Survey Interface" width="25%">

</div>

---

## 📸 Platform Overview

<p align="center">
  <img src="./public/overview.png" alt="SP-Survey Platform Overview" width="90%">
</p>

<p align="center">
  <em>Complete workflow: From image dataset management to survey deployment</em>
</p>

<p align="center">
  <img src="./public/fig_question.png" alt="Image-based question types" width="90%">
</p>

---

## 🚀 Quick Start

### ⚡ Use the online platform (recommended for most users)

**No installation. No Supabase/Vercel setup.** Visit **[sp-survey.org](https://sp-survey.org)**, create an account, and you can:

- Upload images and media
- Build surveys from templates or with AI
- Share survey links in one click
- View and export results online

👉 **[Open sp-survey.org →](https://sp-survey.org)**

---

### Self-host locally (this repo)

For users who need to run locally, use a login-free admin panel, or deploy via GitHub + Vercel themselves.

#### Two Ways to Use SP-Survey

| | **SP-Survey-Platform** (online) | **SP-Survey** (this repo) |
|---|---|---|
| URL | **[sp-survey.org](https://sp-survey.org)** ← use directly | Self-hosted locally |
| Setup | **Zero setup — sign up and go** | Clone + `npm run dev` + Supabase/Vercel |
| Login | Required | **None** — open `/admin` directly |
| Image storage | Cloudflare R2 | **Supabase Storage** (`survey-images` bucket) |
| Deployment | Share link | **GitHub + Vercel** wizard (Step 4) |

### Prerequisites

**Required for full workflow:**
- **Supabase Account** ([supabase.com](https://supabase.com)) — image storage + survey responses
- **Vercel Account** ([vercel.com](https://vercel.com)) — deploy participant-facing survey site

**Optional:**
- **Hugging Face Account** — batch-import image datasets
- **OpenAI / OpenRouter API Key** — AI survey generation & skill authoring

### Installation

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
cp .env.example .env          # optional server port overrides
cp .env.example .env.local      # then set PORT=3020, REACT_APP_API_URL=http://localhost:3021 if needed
npm run dev
```

### Access the Application

- **Admin Panel**: http://localhost:3000/admin (or your `PORT` in `.env.local`)
- **Live Survey**: http://localhost:3000/survey
- **Skill Library**: http://localhost:3000/skills

### Create Your First Survey (5 Steps)

1. **Step 1 — Image Dataset**
   - Configure **Supabase Storage** (Project URL, service_role key, anon key)
   - Upload media directly or optionally import from Hugging Face
2. **Step 2 — Survey Builder**
   - Load a template or build from scratch (image, media, skill, slider, annotation questions)
3. **Step 3 — Server Setup**
   - Create `survey_responses` table in Supabase (SQL provided)
   - Test response saving
4. **Step 4 — Website Deployment**
   - Generate deployment bundle → push to GitHub → deploy on Vercel with anon key
5. **Step 5 — Results Analysis**
   - TrueSkill, MaxDiff, Krippendorff's α, skill charts, CSV export

---

## 🪜 Step-by-Step Workflow

**Step 1 — Image Dataset**
Configure Supabase Storage and upload images, video, or audio. Optional Hugging Face batch import.

**Step 2 — Survey Builder**
Design surveys with drag-and-drop or AI. Includes skill questions, media widgets, annotation, TrueSkill-friendly imagepicker layouts.

**Step 3 — Server Setup**
Create the `survey_responses` table in Supabase and verify the connection (uses credentials from Step 1).

**Step 4 — Website Deployment**
Generate a survey-only bundle, test build, push to GitHub, deploy on Vercel with your **anon key**.

**Step 5 — Results Analysis**
Per-question analytics, skill-specific charts, reliability metrics, CSV export with shown-media metadata.

---

## ✨ Key Features

### 🤖 AI-Powered Survey Generation

- **ChatGPT-Style Interface**: Natural conversation to create and refine surveys
- **Chain of Thoughts**: Transparent 3-step AI reasoning process
- **Multi-Agent Review**: 5 specialized AI experts review your survey
- **Contextual Memory**: AI remembers your preferences and project history

### 🔧 Survey Capabilities

**Image & Media Questions:**
- Image choice, ranking, rating, yes/no, matrix, display
- Media display / rating / boolean (image, video, audio)
- Image annotation, slider groups, point allocation
- **Skill questions** — custom HTML/JS widgets (MaxDiff, video tagging, emotion picker, etc.)

**Analysis (Step 5):**
- TrueSkill (imagepicker), MaxDiff BWS, Krippendorff's α
- Skill-specific charts, annotation heatmaps, methods export

**Research Features:**
- Multi-page surveys, media group/category pairing, exclude-used-images
- Drag-and-drop builder, real-time preview, multi-agent AI review

### 📋 Template System

<p align="center">
  <img src="./public/template-library.jpg" alt="Template Library" width="90%">
</p>

Start with peer-reviewed survey designs (see `public/project_templates/index.json`):

#### 2026
- **SP All Question Types** | `2026-sp-all.json` — QA template covering all question types + preset skills
- **Window View / City** | Peng et al. | `2026-peng-city.json`

#### 2025
- **Thermal Comfort in Sight** | Yang et al. | `2025-yang-thermal.json`
- **SPECS** | Quintana et al. | `2025-quintana-specs.json`
- **Street Multi-Activity Potential** | Li et al. | `2025-li-street.json`
- **Effective Perception Survey** | Gu et al. | `2025-gu-effective.json`
- **City Landmark** (AI) | `2025-fan-city.json`
- **Street Bikeability** (AI) | `2025-ito-street.json`
- **Urban Greenery** (AI) | `2025-torkko-urban.json`

#### 2024 & earlier
- **Building Exterior Perception** | Liang et al. | `2024-liang-building.json`
- Historical templates: Kaplan (1995), Gehl (2010), Streetscore (2014), Place Pulse (2016), Seresinhe (2017)

**How to Use:**
1. Open Admin Panel → Project Sidebar
2. Click **"Load Template"** button
3. Select a template and customize

### 💾 Data & Deployment

- **Supabase Storage** — `survey-images` bucket for media (configured in Step 1)
- **Supabase Database** — `survey_responses` table (configured in Step 3)
- **Vercel** — deploy participant survey (Step 4; uses **anon key only**)
- **Hugging Face** — optional batch image import

### Supabase Setup Summary

| Key | Where to enter | Used for |
|-----|----------------|----------|
| **service_role** | Step 1 Image Dataset | Admin uploads, bucket management |
| **anon** | Step 1 Image Dataset | Embedded in Vercel `.env` for live survey |
| SQL script | Step 3 Server Setup | Creates `survey_responses` with `project_id` |

Run this in Supabase SQL Editor if Step 3 auto-create fails:

```sql
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

---

## 📊 Survey Data Collection

**View Responses:**
1. Supabase Dashboard → Table Editor
2. Export as CSV or JSON
3. Real-time monitoring

---

## 🎓 Academic Citation

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

**📄 [Read the Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514)** | **🔗 [Project Website](https://thermal-affordance.ual.sg)** | **📊 [Dataset](https://github.com/Sijie-Yang/Thermal-Affordance)**

---

## 🆘 Troubleshooting

### Backend Server Offline
```bash
# Use safe mode with auto-restart (recommended)
npm run dev:safe

# Or manual restart
npm run dev
```

### Images Not Loading
1. Check Supabase bucket is public (Storage → Settings → Public bucket)
2. Verify image URLs are accessible
3. Preload images from Hugging Face to Supabase for stable URLs

### Cannot Save Projects
1. Ensure backend server is running (`node server.js`)
2. Check http://localhost:3001/api/projects returns JSON
3. Verify folder permissions

### Supabase Connection Failed
1. **Step 1**: Enter Project ID → auto-fills URL; paste **service_role** + **anon** keys; click Save
2. **Step 3**: Uses the same credentials; run the SQL script if table creation fails
3. For **Vercel**, only the **anon** key is deployed — never commit service_role
4. Ensure `survey-images` bucket is **public** (Storage → bucket settings)

**Getting Help:**
- **GitHub Issues**: [Report a bug](https://github.com/Sijie-Yang/SP-Survey/issues)
- **Discussions**: [Ask questions](https://github.com/Sijie-Yang/SP-Survey/discussions)

---

## 🤝 Contributing

We welcome contributions! Please open an issue or pull request to discuss your ideas.

---

## 📄 License

**CC BY 4.0 (Creative Commons Attribution 4.0 International)**

This work is licensed under a [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

**You are free to:**
- ✅ Share — copy and redistribute the material
- ✅ Adapt — remix, transform, and build upon the material
- ✅ Commercial use allowed

**Under the following terms:**
- 📝 **Attribution** — You must give appropriate credit and cite the original paper



---

## 🌟 Acknowledgments

**Developed by Urban Analytics Lab, Department of Architecture, National University of Singapore**

**Technology Stack:**
- SurveyJS, Material-UI, React 18.2, Node.js/Express
- OpenAI GPT-4o (AI features)
- Supabase (Database & Storage)
- Hugging Face (Dataset hosting)
- Vercel (Deployment)
