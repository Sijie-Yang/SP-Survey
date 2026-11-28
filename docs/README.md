# GitHub Pages redirect

The template gallery that used to live here has moved to [sp-survey.org](https://sp-survey.org). `index.html` only redirects there.

Templates for published papers are requested at [sp-survey.org/request-template](https://sp-survey.org/request-template).

The template library lives in `public/project_templates/` (one file per template plus `catalog.json`); `node scripts/sync-templates.mjs` mirrors it from sp-survey.org and `node scripts/build-template-catalog.mjs` writes the template list of the main README from it. `cover.jpg` and `showcase.jpg` are the two images at the top of the main README; `ual-logo.png` and `ual-logo-dark.png` are the lab logo below them, for light and dark pages.
