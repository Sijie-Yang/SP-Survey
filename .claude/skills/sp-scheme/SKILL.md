---
name: sp-scheme
description: Build, run and analyse a visual perception experiment (street views, images, video) as one SP-Scheme web page with the SP-Survey Kit — new study, replication of a published study, self-hosting, data export, or adding a paper to the study library.
---

# SP-Scheme perception experiments

You help a researcher run a perception experiment (people judge images, videos or sounds) that follows the **SP-Scheme** standard, so its data can be compared and pooled with every other SP-Scheme study. The researcher may not be technical: explain in plain words, one step at a time, and check with them before anything that costs money or reaches participants.

Read `kit/SP-SCHEME.md` before writing a page. It is the contract. Everything that must be right is done by deterministic code in `kit/` — never re-implement it yourself:

- `kit/sp-site.js` — draws media per participant (random or balanced), checks every answer against its question type, stores responses.
- `kit/sp.mjs` — `library`, `new`, `check`, `serve`, `export`.
- `kit/supabase.sql` — the researcher's own database (responses + balanced-draw numbers).

## 1. Start from the library when you can

```bash
node kit/sp.mjs library safety          # published studies to start from + matching papers (kit/library/papers.csv)
node kit/sp.mjs new my-study --from 2016-dubey-place
```

A study from the library keeps the published questions, wording and scales; its `STUDY.md` says how it differs from the original. Tell the researcher those differences. For a new design: `node kit/sp.mjs new my-study` (example page), then design with them (research question, what is judged, how many images per person, language, length) and edit the `sp-scheme` JSON block.

## 2. Design rules

- Every recorded answer is a declared question with a native type (SP-SCHEME.md §3), or `custom` if nothing fits. Never invent types.
- Stimuli are real files in the study folder (`stimuli/`, `streets/`, …). Each media question names its folder in `mediaFolders`. Never hard-code image URLs, never draw pictures with code to stand in for photos, never generate photos with AI.
- Use `"pairingMode": "balanced"` when per-image results matter (scores, rankings): every image is then shown equally often. Pairwise comparison = `imagepicker` with `imageCount: 2` and `trialCount` rounds. Fixed pairs = `"mediaAssignmentMode": "set"`, one folder per pair.
- The page may look like anything the researcher wants. Keep `<script src="sp-site.js"></script>` inside the `<!-- sp-site-preview:start -->` … `end` markers, record only with `SPSite.answer`, finish with `SPSite.complete()`.
- Start with a `consent` question when collecting data from people.

## 3. Check and try

```bash
node kit/sp.mjs check my-study    # fix every ✗; read the draw summary to the researcher
node kit/sp.mjs serve my-study    # http://localhost:4173 — responses go to my-study-responses/
```

Open it at phone width (390 px) and desktop width, click through once yourself, then ask the researcher to try it. `node kit/sp.mjs export my-study` must show the answers you expect.

## 4. Go live (researcher does the account steps)

1. Supabase: create a project, open SQL Editor, run `kit/supabase.sql`.
2. Put the Project URL and the **anon / publishable** key in `my-study/sp-config.json`. Never the service-role key, never in chat.
3. Deploy the folder as a static site (Cloudflare Pages, Netlify, Vercel, GitHub Pages, any web server). Re-run `check` after adding images (it rewrites `media.json`).
4. Recruitment: links may carry `?PROLIFIC_PID=…` / `?participant=…`; set `completionUrl` for the platform's completion link.

Or skip hosting: zip the folder and import it in SP-Survey Studio at https://sp-survey.org (the same page runs there, with recruitment links, dashboards and dataset packages), or use its MCP connector `https://sp-survey.org/mcp`.

## 5. Analyse

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node kit/sp.mjs export my-study   # set in the shell only
```

`answers_long.csv` (one row per answer and round, with the files shown and the chosen file) and `image_scores.csv` (per file: shown, chosen, choice rate, mean rating). Analyse those files with ordinary code (pandas, R); report numbers you computed, not estimates. For pairwise data use TrueSkill or Bradley–Terry; state N participants, N answers per image, and that draws were balanced (from `survey_metadata.balanced_draw.claim` = `server`).

Methods sentence to adapt: "The survey was built to the SP-Scheme 2.0 standard and run with SP-Survey Kit (Yang et al., SP-Survey); images were assigned per participant by a balanced, seeded draw so that each image was shown equally often."

## 6. Add a published study to the library

When the researcher gives a paper (PDF or DOI) that measures perception with images: rebuild its questionnaire as an SP-Scheme survey (original wording, scales, number of comparisons; list every difference from the original), add an entry to `kit/library/studies.json` (`id` = `year-firstauthor-firstword`, `title`, `authors`, `year`, `link`, `doi`, `description` ending with "Differences from the original study: …", `survey`), run `node --test kit/kit.test.mjs`, and open a pull request to https://github.com/Sijie-Yang/SP-Survey. Never include the paper's images unless their licence allows it.
