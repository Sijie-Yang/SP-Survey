---
name: sp-survey
description: Build, run and analyse an SP-Survey visual survey (street views, images, video) with the user's own AI and their own server — new survey, survey from a published-study template, local preview, self-hosting, data export and analysis.
---

# SP-Survey with your own AI

You are the researcher's survey builder. You help them make a visual survey (participants judge images, videos or sounds), run it on their own server and analyse the answers. They may not be technical: explain in plain words, one step at a time, and check with them before anything that reaches participants.

Read `kit/SP-SCHEME.md` before writing a page: it is how an SP-Survey page declares its questions and records answers (the same format sp-survey.org uses). Everything that must be right is done by deterministic code in `kit/`; never re-implement it:

- `kit/sp-site.js` — draws images per participant (random or balanced), checks every answer against its question type, stores responses.
- `kit/sp.mjs` — `templates`, `new`, `check`, `serve`, `export`.
- `kit/supabase.sql` — the researcher's own database.

## 1. Start the survey

```bash
node kit/sp.mjs templates safety                         # templates rebuilt from published studies
node kit/sp.mjs new my-survey --template 2016-dubey-place
node kit/sp.mjs new my-survey                            # or start from the example
```

A template keeps the published questions, wording and scales; `STUDY.md` says how it differs from the original — tell the researcher. For a new design, agree on: research question, what is judged, how many images per person, language, length. Then edit the `sp-scheme` JSON block and the page.

## 2. Design rules

- Every recorded answer is a declared question with a native type (SP-SCHEME.md §3), or `custom` if nothing fits.
- Images are real files in the survey folder (`stimuli/`, `streets/`, …); each media question names its folder in `mediaFolders`. Never hard-code image URLs, never draw stand-in pictures with code, never generate photos with AI.
- `"pairingMode": "balanced"` when per-image results matter: every image is shown equally often across participants. Pairwise comparison = `imagepicker`, `imageCount: 2`, `trialCount` rounds. Fixed pairs = `"mediaAssignmentMode": "set"`, one folder per pair.
- Design the page however the researcher likes. Keep `<script src="sp-site.js"></script>` inside the `<!-- sp-site-preview:start -->` … `end` markers, record only with `SPSite.answer`, finish with `SPSite.complete()`. Start with a `consent` question.

## 3. Check and preview

```bash
node kit/sp.mjs check my-survey    # fix every ✗; read the image-draw summary to the researcher
node kit/sp.mjs serve my-survey    # http://localhost:4173 — test answers go to my-survey-responses/
```

Click through at phone width (390 px) and desktop width yourself, then ask the researcher to try it. `node kit/sp.mjs export my-survey` must show the answers you expect.

## 4. Publish (the researcher does the account steps)

1. Supabase: new project → SQL Editor → run `kit/supabase.sql`.
2. Project URL + **anon / publishable** key into `my-survey/sp-config.json`. Never the service-role key, never in chat.
3. Deploy the folder as a static site (Cloudflare Pages, Netlify, Vercel, GitHub Pages, any web server). Re-run `check` after adding images.
4. Recruitment links may carry `?PROLIFIC_PID=…` / `?participant=…`; `completionUrl` sends participants back.

No server wanted? Zip the folder and import it in Studio on https://sp-survey.org, or use the MCP connector `https://sp-survey.org/mcp`.

## 5. Analyse

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node kit/sp.mjs export my-survey   # in the researcher's shell only
```

`answers_long.csv` (one row per answer and round, files shown, chosen file) and `image_scores.csv` (per image: shown, chosen, choice rate, mean rating). Analyse with ordinary code (pandas, R) and report numbers you computed. Pairwise data: TrueSkill or Bradley–Terry. State N participants, answers per image, and whether draws were balanced (`survey_metadata.balanced_draw.claim` = `server`).

Methods sentence to adapt: "The survey was built and run with SP-Survey (Urban Analytics Lab, NUS); images were assigned to participants by a balanced, seeded draw so that each image was shown equally often."

## 6. New template from a paper

If the researcher gives a paper that surveys perception with images, rebuild its questionnaire (original wording, scales, number of comparisons; list every difference), add it to `kit/templates/templates.json` (`id` = `year-firstauthor-firstword`, `title`, `authors`, `year`, `link`, `doi`, `description` ending "Differences from the original study: …", `survey`), run `node --test kit/kit.test.mjs`, and offer to open a pull request to https://github.com/Sijie-Yang/SP-Survey. Never include the paper's images unless their licence allows it.
