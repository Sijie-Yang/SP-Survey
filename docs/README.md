# GitHub Pages redirect

The template gallery that used to live here has moved to [sp-survey.org](https://sp-survey.org). `index.html` only redirects there.

Templates for published papers are added at [sp-survey.org/add-template](https://sp-survey.org/add-template).

The template library lives in `public/project_templates/` (one file per template plus `catalog.json`); `node scripts/sync-templates.mjs` mirrors it from sp-survey.org and `node scripts/build-template-catalog.mjs` writes the template list of the main README from it. `cover.jpg` and `showcase.jpg` are the two images at the top of the main README and `library.jpg` is the overview above its template list; `node scripts/build-readme-images.mjs` redraws `cover.jpg` and `library.jpg` from the current library (it needs Playwright, see the top of the script); `logos.png` and `logos-dark.png` are the lab and university logos below them, for light and dark pages (the dark one sets the same logos on a white plate).
