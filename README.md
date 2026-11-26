<div align="center">

# SP-Survey

[![Stars](https://img.shields.io/github/stars/Sijie-Yang/SP-Survey?style=social)](https://github.com/Sijie-Yang/SP-Survey)
[![Website](https://img.shields.io/badge/🌐-sp--survey.org-blue)](https://sp-survey.org)
[![Paper](https://img.shields.io/badge/📄-Paper-9cf)](https://www.sciencedirect.com/science/article/pii/S0360132325000514)
[![License](https://img.shields.io/badge/License-CC_BY_4.0-green)](https://creativecommons.org/licenses/by/4.0/)

<img src="./public/fig_introduction.png" alt="SP-Survey" width="100%">

Image-based perception surveys: design with AI, run with your own Supabase, deploy anywhere.

**No login · Local project files · Your Supabase · Your deployment**

[Hosted platform](https://sp-survey.org) · [Paper](https://www.sciencedirect.com/science/article/pii/S0360132325000514) · [Discussions](https://github.com/Sijie-Yang/SP-Survey/discussions) · [Issues](https://github.com/Sijie-Yang/SP-Survey/issues)

</div>

## Community

- English: [GitHub Discussions](https://github.com/Sijie-Yang/SP-Survey/discussions).
- 中文：扫码加入 SP-Survey 微信群。

<div align="center">
<img src="./public/wechat-group-cn.jpg" alt="SP-Survey 中文微信群" width="200">
</div>

## Same features as sp-survey.org

This repository has the same survey and research features as the [hosted platform](https://sp-survey.org): Studio, the AI Assistant (SP-Scheme and Classic modes), SP-Scheme pages, image/video/audio questions, repeated trials, balanced image draws, annotation and SAM pre-annotation, custom skills, recruitment platforms (Prolific and others), Results with AI analysis, silicon pretests and templates.

Only the infrastructure differs:

| | Hosted platform | SP-Survey (this repo) |
|---|---|---|
| Access | Account | No login |
| Projects | Managed | Local JSON files in `public/projects/` |
| Media and responses | Managed | Your Supabase |
| Participant site | Hosted | You deploy it (e.g. Vercel) |
| AI models | Your key or the free model | Your key |

## Quick start

Requires Node.js 22+ (or 20.19+).

```bash
git clone https://github.com/Sijie-Yang/SP-Survey.git
cd SP-Survey
npm install
npm run dev
```

- **Studio** (describe a study, the AI writes the page): http://localhost:3000/studio
- **Classic editor**: http://localhost:3000/admin
- Local survey: http://localhost:3000/survey · local API: http://localhost:3001

Add your model key (OpenAI, DeepSeek, OpenRouter, Qwen, …) in the AI Assistant settings. Keys stay on your computer in `data/`, which Git ignores.

## Run a study

1. **Supabase.** Create a project at [supabase.com](https://supabase.com). On the editor's **Dataset** tab, enter the project URL, anon key and `service_role` key. Upload images there, import from Hugging Face, or download street views with the street-level helper.
2. **Design.** In Studio, describe the study and let the AI write the SP-Scheme page, or drop in a page your own AI built. Or build it question by question in the classic editor. A page is saved only when it passes the SP-Scheme check.
3. **Check.** Use the preview, Researcher Practice and the local survey link, including on a phone.
4. **Host.** On the **Host** tab, run [`supabase/setup.sql`](./supabase/setup.sql) in Supabase → SQL Editor (safe to run again after updates). Release the draft, build the participant site, push it to GitHub and import it in Vercel with:
   ```text
   REACT_APP_SUPABASE_URL=https://your-project.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=your-anon-key
   ```
   Submit one test response and check it in Supabase → `survey_responses`.
5. **Share and analyze.** Copy the link or QR code on **Share** (recruitment platforms included). Responses appear in **Results**, with charts, AI analysis and exports.

Changes reach participants only after you release again and redeploy.

## Use with Codex, Claude Code or Cursor

While `npm run dev` is running, a local agent API (this machine only) lets a coding agent create and edit projects, validate, release and read results. Start with `GET http://localhost:3001/api/agent`, which lists every endpoint; see [AGENTS.md](./AGENTS.md). Agent reads never include credentials. Enter keys only in the SP-Survey interface, never in a chat.

## Security

- Never commit or deploy the `service_role` key. The participant site gets only the URL and anon key.
- `.env`, local projects, backups, responses and keys are ignored by Git.
- Check consent, data retention and your institution's rules before collecting data.

## Development

```bash
CI=true npm test -- --watchAll=false
npm run test:server
npm run build
```

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
