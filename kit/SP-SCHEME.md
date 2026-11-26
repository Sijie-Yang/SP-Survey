<!--
  SP-Scheme 2.0 — the shared contract between an AI-built survey page and SP-Survey.
  This file is the same text sp-survey.org hands to models (Builder → SP-Scheme),
  exported from SP-Survey-Platform src/lib/spScheme.js. A page that follows it runs
  on sp-survey.org AND self-hosted with the SP-Survey Kit, unchanged.
-->

# Self-hosting this page with the SP-Survey Kit (read first)

Everything below applies. When the study runs on your own server instead of sp-survey.org, four things differ:

1. **Runtime.** Put `<script src="sp-site.js"></script>` inside the `<!-- sp-site-preview:start -->` block, before the preview shim, and copy `kit/sp-site.js` next to `index.html`. sp-site.js provides the real `SPSite`; the shim then stays idle. sp-survey.org removes the whole block on upload, so the same page works there too.
2. **Media library = the study folder.** Images live in folders next to `index.html` (for example `streets/`). Give each media question `"mediaFolders": ["streets"]`. `node kit/sp.mjs check <folder>` lists every file into `media.json`, which sp-site.js reads.
3. **Balanced draws.** Add `"pairingMode": "balanced"` to a media question to show every file equally often across participants (each participant claims a number from your Supabase; see `kit/supabase.sql`). Without it files are drawn uniformly at random (Fisher–Yates). `"mediaAssignmentMode": "set"` treats each folder of exactly `imageCount` files as one set (fixed pairs: folders with 2 images).
4. **Storage.** `sp-config.json` holds `projectId`, `supabaseUrl` and the **anon** key only (it is public). Responses go to your `survey_responses` table. `completionUrl` (optional) is opened after submitting, e.g. a Prolific completion link; `{participant}` is replaced by the participant id. Participant ids come from `?PROLIFIC_PID=`, `?participant=`, `?pid=` or `?workerId=`, else a random id. There is no network sandbox when self-hosted, but still record answers only through `SPSite.answer` so the data stays analysable.

Instructions in the text below about "importing into Studio" apply only when uploading to sp-survey.org.

---

# SP-Scheme 2.0 — build an SP-Survey study as your own web page

You are helping a researcher build a perception survey for SP-Survey (https://sp-survey.org). The researcher may not be technical.

You design the whole participant experience as ONE web page, `index.html`: welcome and consent, every task, page flow, visuals, animation, wording. Participants open the survey link and get exactly this page; the researcher's Builder preview shows exactly this page too. There is no platform form style to fit into.

The platform takes care of three things; how much of your data it can analyse depends on how closely you follow them (the Builder and the Results page say so plainly):
1. **Stimuli.** Images / videos / audio come from the researcher's media pool: either the platform draws them for each participant and hands them to your page, or your page reads whole folders with `SPSite.getMedia(folder)` and keeps its own randomisation (section 2). You never choose, invent or hard-code media URLs.
2. **Question description.** Every answer you record belongs to a question declared in the survey JSON embedded in the page (section 1). A native type (section 3) gets the platform's analysis; an answer no native type fits is declared `custom` and is stored and exported as is, not analysed.
3. **Answer recording.** You record answers only with `SPSite.answer(...)` and finish with `SPSite.complete()` (section 4). The platform checks every value, stores it, and handles submission and the thank-you screen.

## 0. Workflow — follow these steps in order

**Step 1 · Understand the study.** Ask briefly for what you need: research question, what participants judge, language, how many images each person sees, roughly how long it should take. Suggest a design in plain language before writing code.
The researcher may instead bring an existing survey: a link or screenshots of a survey on another site (Qualtrics, Google Forms, a lab website), an exported file (.qsf, .docx, .pdf) or a page made earlier. Then fit that survey to SP-Scheme: keep its questions, wording, answer options, order and stimuli as they are, map each question to a native type (section 3) or `custom`, and list plainly anything that cannot be kept the same.

**Step 2 · Build index.html and let the researcher try it.** Write the page with the embedded survey JSON (section 1) and the preview shim (section 5), and show it in your preview / canvas / artifact view (or tell the researcher to save it and open it in a browser). The shim fills in placeholder images and shows the recorded data in a small panel, so the page works fully before it reaches the platform. Ask the researcher to click through it on a phone-sized and a desktop-sized window. Change it until they say they are happy. Do NOT hand over the final file before the researcher confirms.

**Step 3 · Hand over the same page, as a zip.** The file the researcher approved IS the deliverable; do not rebuild or simplify it. Put `index.html` and every file it uses (images, CSS, JS, data) into one zip, keeping their folders. Stimulus images must be real image files in the zip (for example `images/street_01.jpg`), never pictures your code draws (SVG, canvas or CSS art) to stand in for photos: on import they go into the project's media library under the same folders, and the page finds them by the same relative paths. The platform treats the media library as the folder index.html sits in.
If you cannot make files, give the whole page in one ```html code block and tell the researcher: "save this as index.html, put it in a zip together with the images it uses".
Then tell them how to import it: open SP-Survey Studio, click "New study" (新建研究), drag the zip (or index.html) in, read the check and click Import. An agent connected to the SP-Survey MCP server calls `sp_scheme_import` instead (a zip goes up through `sp_scheme_upload_url` first). If the check lists problems, they come back to you; return a corrected page.

## 1. The embedded survey JSON

Put this block inside `<head>`, before the preview shim:

```html
<script type="application/json" id="sp-scheme">
{
  "format": "sp-scheme-package",
  "spScheme": "2.0",
  "survey": {
    "title": "...", "description": "...", "locale": "en | zh",
    "pages": [ { "name": "...", "elements": [ /* one entry per recorded question */ ] } ]
  }
}
</script>
```

- One element per thing you record, with a native `type` from section 3. The type decides the answer format and the analysis the researcher gets; your page decides how it looks. For example a two-image "tap the safer street" game is an `imagepicker` with `imageCount: 2` (analysed with TrueSkill rankings), a swipe-left/right card is an `imageboolean`, a drag-to-sort board is an `imageranking`, a set of dials is an `imageslidergroup`. Rating one image on a few labelled options ("clean / minor issues / vacant") is an `imagerating` with `imageCount: 1`, `rateMin`/`rateMax` and `rateLabels` (one label per option); an `imagepicker` is only for choosing between two or more images.
- Every element has a unique, stable `name` (lowercase letters, digits, underscores). Choice, row, column and dimension ids must be unique within their question.
- `title` / `description` hold the wording, in the survey's `locale` language; your page may show them or its own text.
- Pages group questions for the researcher's overview only; your page decides the real flow.
- Start with a `consent` question when the study collects data from people, and mark questions the participant must answer with `"isRequired": true`.
- Do not include API keys, tokens, Supabase settings or any credential.

## 2. Stimuli and randomisation

Images, videos and audio come from the researcher's project media pool; you never invent or hard-code media URLs. Two ways to draw them, mixable per question:

**A. Platform draws (default when you design the page from scratch).** The platform draws the files for each participant, records exactly what was shown, and passes them to your page as `question.media` (or `question.trials[i].media`). Show only these; placeholders exist only in your preview.

**Paths.** The media library is the page's own folder: `<img src="images/a.jpg">` (or a CSS `url(images/a.jpg)`) shows the library file `a.jpg` in folder `images`. An empty image list in your code (for example `const PHOTO_URLS = []`) is filled with the images of the folders the researcher links in the Builder (the library root when none), in a random order for each participant; record the file names you show, not your own ids.

**B. Your page draws (default when a page already has its own randomisation).** Declare the folders at the survey level by their names in the media library (the same as the folders of the researcher's zip, for example `"mediaFolders": ["images"]`), and read them with `SPSite.getMedia('task_a')` → `[{ url, name, type }]` (the whole folder). Keep the page's own logic for sampling, grouping, pairing and ordering, and record each answer with `SPSite.answer(name, value, { key, shown })`: `shown` lists the file names shown for that answer and `key` (for example the image id) makes a later answer replace an earlier one for the same item. The platform then records what was shown exactly like in A.

Settings for A:
- Default for every media question: `"imageSelectionMode": "huggingface_random", "randomImageSelection": true, "excludePreviouslyUsedImages": true` and `"choices": []`.
- `imageCount` = how many files are drawn per presentation. `trialCount` = how many rounds the question repeats, each with a fresh draw; each round is recorded separately, so loop over `question.trials` in your page rather than declaring many similar questions.
- `mediaAssignmentMode`: `individual` (random files, default), `set` (one whole folder tagged set; imageCount must equal the folder size) or `category` (folders tagged category). `mediaFolders` optionally limits eligible folders.
- If the researcher must curate specific files, use `"imageSelectionMode": "huggingface_manual"` and tell them to pick the files in the Builder after import.
- Remind the researcher to upload their images to the project's Media Dataset before publishing.

Platform rules:

- Question names must be unique across the survey.
- Never send API keys, HuggingFace tokens, fal keys, or Supabase credentials.
- Optional survey locale: en (default) or zh. Participant chrome (progress, trials, Next) follows this setting, not the researcher admin language.
- Media pipeline has several layers (see mediaAssignment). Default simple case: imageSelectionMode=huggingface_random (UI: Random from project media pool), mediaAssignmentMode=individual, choices:[]. Runtime injects files from the project Media Dataset.
- media* may use mediaSlots for multi-modal (video+audio+image). Empty mediaSlots = legacy single-pool path.
- Never invent media URLs; never send HuggingFace/fal/API keys. Folder tags (set/category) live on the project Media Dataset, not as fake URLs.

## 3. Native question types

- `text` — Short typed answer · kind `text`
  example: `{"type":"text","name":"open_note","title":"What stands out?"}`
- `comment` — Long typed answer · kind `text`
  example: `{"type":"comment","name":"open_comment","title":"Describe the scene","rows":4}`
- `number` — Numeric value · kind `number`
  example: `{"type":"number","name":"count_people","title":"How many people?","min":0,"max":50}`
- `radiogroup` — Single text choice · kind `choice`
  example: `{"type":"radiogroup","name":"single_choice","title":"Which statement fits?","choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}]}`
- `checkbox` — Multi text tags without a stimulus image · kind `multiChoice`
  example: `{"type":"checkbox","name":"text_tags","title":"Which apply?","choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}]}`
- `ranking` — Rank researcher-defined text items · kind `ranking`
  example: `{"type":"ranking","name":"rank_qualities","title":"Rank these qualities","choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}]}`
- `rating` — Numeric rating without media · kind `rating`
  example: `{"type":"rating","name":"overall_rating","title":"Overall rating","rateMin":1,"rateMax":7,"minRateDescription":"Low","maxRateDescription":"High"}`
- `boolean` — Yes/No without media · kind `boolean`
  example: `{"type":"boolean","name":"yes_no","title":"Does this apply?","labelTrue":"Yes","labelFalse":"No"}`
- `dropdown` — Compact single choice · kind `choice`
  example: `{"type":"dropdown","name":"dropdown_choice","title":"Select one","choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}]}`
- `matrix` — Text matrix of statements × scale · kind `matrix`
  example: `{"type":"matrix","name":"text_matrix","title":"Rate each statement","rows":[{"value":"row_a","text":"Row A"},{"value":"row_b","text":"Row B"}],"columns":[{"value":"col_low","text":"Low"},{"value":"col_high","text":"High"}]}`
- `expression` — Instruction only · shows content, records nothing
  example: `{"type":"expression","name":"intro_note","title":"Please look at the following scenes."}`
- `consent` — Required consent · kind `boolean`
  example: `{"type":"consent","name":"consent","title":"I consent to participate","isRequired":true,"labelTrue":"I agree","labelFalse":"I do not agree"}`
- `slidergroup` — Several bipolar scales without media · kind `sliders` · required: dimensions
  example: `{"type":"slidergroup","name":"text_sliders","title":"Rate these attributes","scaleMin":0,"scaleMax":100,"dimensions":[{"id":"attr_a","label":"Attribute A","left":"Low","right":"High"},{"id":"attr_b","label":"Attribute B","left":"Low","right":"High"}]}`
- `pointallocation` — Allocate a budget across researcher-defined items · kind `allocation`
  example: `{"type":"pointallocation","name":"allocate_points","title":"Allocate 100 points","budget":100,"choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}]}`
- `imagepicker` — Choose among images drawn from the media pool · kind `choice` · media drawn by the platform
  example: `{"type":"imagepicker","name":"pick_scene","title":"Which scene do you prefer?","imageCount":4,"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imageranking` — Rank images drawn from the media pool · kind `ranking` · media drawn by the platform
  example: `{"type":"imageranking","name":"rank_scenes","title":"Rank these scenes","imageCount":4,"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imagerating` — Rate one or more images · kind `rating` · media drawn by the platform
  example: `{"type":"imagerating","name":"rate_scene","title":"How would you rate this scene?","imageCount":1,"rateMin":1,"rateMax":7,"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imageboolean` — Yes/No about an image · kind `boolean` · media drawn by the platform
  example: `{"type":"imageboolean","name":"scene_yes_no","title":"Is this walkable?","imageCount":1,"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imagecheckbox` — Researcher-defined text tags about an image · kind `multiChoice` · media drawn by the platform
  example: `{"type":"imagecheckbox","name":"scene_tags","title":"Which features apply?","imageCount":1,"choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imagematrix` — Matrix under an image · kind `matrix` · media drawn by the platform
  example: `{"type":"imagematrix","name":"scene_matrix","title":"Rate each aspect of this scene","imageCount":1,"rows":[{"value":"row_a","text":"Row A"},{"value":"row_b","text":"Row B"}],"columns":[{"value":"col_low","text":"Low"},{"value":"col_high","text":"High"}],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `image` — Display-only image · shows content, records nothing · media drawn by the platform
  example: `{"type":"image","name":"show_scene","title":"Look at this scene","imageCount":1,"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imageannotation` — Draw on an image · kind `annotation` · media drawn by the platform
  example: `{"type":"imageannotation","name":"mark_scene","title":"Mark the relevant areas","imageCount":1,"allowedTools":["point","bbox"],"annotationLabels":["object"],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imageslidergroup` — Bipolar sliders about an image · kind `sliders` · media drawn by the platform · required: dimensions
  example: `{"type":"imageslidergroup","name":"scene_sliders","title":"Rate this scene on each attribute","imageCount":1,"scaleMin":0,"scaleMax":100,"dimensions":[{"id":"attr_a","label":"Attribute A","left":"Low","right":"High"},{"id":"attr_b","label":"Attribute B","left":"Low","right":"High"}],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `imagepointallocation` — Allocate points across researcher-defined labels with an image · kind `allocation` · media drawn by the platform
  example: `{"type":"imagepointallocation","name":"scene_budget","title":"Allocate 100 points","imageCount":1,"budget":100,"choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediapicker` — Choose among media from the pool · kind `choice` · media drawn by the platform
  example: `{"type":"mediapicker","name":"pick_media","title":"Which clip do you prefer?","mediaType":"any","imageCount":4,"mediaSlots":[],"mediaPresentation":"stack","imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediaranking` — Rank media from the pool · kind `ranking` · media drawn by the platform
  example: `{"type":"mediaranking","name":"rank_media","title":"Rank these clips","mediaType":"any","imageCount":4,"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediarating` — Rate media from the pool · kind `rating` · media drawn by the platform
  example: `{"type":"mediarating","name":"rate_media","title":"Rate this clip","mediaType":"image","imageCount":1,"rateMin":1,"rateMax":7,"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediaboolean` — Yes/No about media · kind `boolean` · media drawn by the platform
  example: `{"type":"mediaboolean","name":"media_yes_no","title":"Does this apply to the clip?","mediaType":"any","imageCount":1,"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediacheckbox` — Researcher-defined tags about media · kind `multiChoice` · media drawn by the platform
  example: `{"type":"mediacheckbox","name":"media_tags","title":"Which apply?","mediaType":"any","imageCount":1,"choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}],"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediamatrix` — Matrix under media · kind `matrix` · media drawn by the platform
  example: `{"type":"mediamatrix","name":"media_matrix","title":"Rate each aspect","mediaType":"image","imageCount":1,"rows":[{"value":"row_a","text":"Row A"},{"value":"row_b","text":"Row B"}],"columns":[{"value":"col_low","text":"Low"},{"value":"col_high","text":"High"}],"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediadisplay` — Display-only media · shows content, records nothing · media drawn by the platform
  example: `{"type":"mediadisplay","name":"show_media","title":"Watch this clip","mediaType":"any","imageCount":1,"displayMode":"single","mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediaslidergroup` — Bipolar sliders about media · kind `sliders` · media drawn by the platform · required: dimensions
  example: `{"type":"mediaslidergroup","name":"media_sliders","title":"Rate this clip","mediaType":"image","imageCount":1,"scaleMin":0,"scaleMax":100,"dimensions":[{"id":"attr_a","label":"Attribute A","left":"Low","right":"High"},{"id":"attr_b","label":"Attribute B","left":"Low","right":"High"}],"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `mediapointallocation` — Allocate points with media · kind `allocation` · media drawn by the platform
  example: `{"type":"mediapointallocation","name":"media_budget","title":"Allocate 100 points","mediaType":"any","imageCount":1,"budget":100,"choices":[{"value":"opt_a","text":"Option A"},{"value":"opt_b","text":"Option B"},{"value":"opt_c","text":"Option C"}],"mediaSlots":[],"imageSelectionMode":"huggingface_random","randomImageSelection":true,"excludePreviouslyUsedImages":true}`
- `custom` — Page Record (SP-Scheme, not analysed) · kind `custom`
  example: `{"type":"custom","name":"custom_q","title":"Page Record (SP-Scheme, not analysed)"}`

Use a native type whenever the answer fits its shape: the researcher then gets the platform's analysis. When a page records something no native type fits (its own composite record, a trace, a free structure), declare it with `"type": "custom"`: the value is any JSON (≤ 32 KB), stored and exported as is, never analysed — the researcher is told so in the Builder and on the Results page. Never force a value into a native type it does not fit.

Answer value for each kind (what you pass to `SPSite.answer`):

- `text`: a string
- `number`: a number within min/max
- `rating`: a number from rateMin to rateMax (or one of rateValues)
- `boolean`: true or false
- `choice`: one choices[].value (string)
- `multiChoice`: an array of choices[].value
- `ranking`: an array of every choices[].value, best first
- `sliders`: an object { <dimension id>: number }
- `matrix`: an object { <row value>: <column value> } for every row
- `allocation`: an object { <choice value>: points } summing to budget
- `annotation`: an object { shapes: [{ tool, label, points: [{ x, y }] }] } with x/y normalised 0–1
- `custom`: any JSON (≤ 32 KB); the platform stores it as is and does not analyse it

For `choice` / `multiChoice` / `ranking` / `allocation`, the allowed values are exactly `question.choices[].value` (per round: `question.trials[i].choices`). For image and media choice types those choices ARE the drawn files: each has `value` (`image_0`, `image_1`, … or `media_0`, …) and `imageUrl`; record the `value`, never the URL.

## 4. SPSite — the only way to record answers

On the platform `window.SPSite` exists before your scripts run. Use it like this:

```js
SPSite.onReady(function (ctx) {
  // ctx.questions: array of question objects (below); ctx.survey: { title, description, language }
  // ctx.answers: answers already recorded (after a participant resumes); start your UI here
});
SPSite.getQuestion('safety_duel');            // one question object
SPSite.answer('rate_scene', 5);                // returns a Promise of { ok, error }
SPSite.answer('safety_duel', 'image_1', { trial: 2 });  // repeated question: round index 0…trialCount-1
SPSite.answer('rate_scene', null);             // clear an answer
SPSite.getMedia('task_a');                     // files of a survey-level mediaFolders entry: [{ url, name, type }]
SPSite.answer('task_a', 2, { key: 'IMG0279', shown: ['IMG0279.jpg'] });  // page-drawn media: one record per item
SPSite.complete();                             // Promise of { ok, missing, error }
```

A question object: `{ name, type, kind, answerShape, title, description, required, trialCount, media: [{ url, name, type }], choices: [{ value, text, imageUrl? }], trials: [{ media, choices }] /* when trialCount > 1 */ }` plus, by kind, `min/max`, `rateMin/rateMax/rateValues/minLabel/maxLabel`, `labelTrue/labelFalse`, `dimensions: [{ id, label, left, right, min, max, step }]`, `rows/columns`, `budget`, `tools/labels/minShapes/maxShapes`. `media[].type` is `image`, `video` or `audio`.

- Call `SPSite.answer` whenever an answer is made or changed. Check `ok`; on `ok: false` show `error` and let the participant fix it (it means the value did not fit the question).
- Call `SPSite.complete()` once at the end, when the participant reaches the last screen or presses its finish button; without it the platform never knows the survey is over. A page that keeps its answers in localStorage instead must save a top-level `"done": true` in that saved object at the end (the platform then submits). Never tell participants their data stays only in their browser: it is sent to the researcher's project. On `ok: true` the platform submits and shows its thank-you screen, so show only a short "Submitting…" state. On `ok: false`, `missing` lists required questions still unanswered; take the participant back to them.
- Record timing or extra behaviour only through declared questions (for example a `number` question for a reaction time in milliseconds).

Runtime limits on the platform (the page runs full-screen in a sandboxed frame):
- No network: `fetch`, XHR, WebSocket and form posts are blocked; nothing leaves the page except through SPSite. A researcher can allow named domains in the Builder (`SPSite.allowedHosts`) for pages that must load something at run time. Posts to any other host are not sent: they resolve as a success and their payload is passed to `SPSite.onSubmit(function (item) { /* item.kind, item.url, item.method, item.data */ })`, so an older page's "send results" call can be mapped onto `SPSite.answer`. For a page that expects its own server, `SPSite.onRequest(function (req) { if (req.url === '/api/state') return { json: { … } }; })` answers any request that would otherwise be blocked (`req.url` is the path for same-page URLs; `req.method`, `req.data`); returning nothing leaves it blocked.
- Scripts must be inline or loaded from https://cdn.jsdelivr.net, https://cdnjs.cloudflare.com, https://unpkg.com, https://cdn.tailwindcss.com, https://esm.sh; styles may also use Google Fonts. Images and media load over https only (the platform's), or data: URLs for your own decoration.
- `localStorage` works only in memory for the session; do not rely on it.
- No navigation to other pages, no new windows for survey content, no iframes, no camera or microphone.
- Make it work on a phone (≥360px wide) and by keyboard; give images alt text; keep the file under 3 MB.

## 5. Preview shim

Paste this block unchanged inside `<head>`, right after the embedded survey JSON. It provides SPSite with placeholder images in your preview and in a plain browser, and shows the recorded data. The platform removes it on import and supplies the real SPSite and media:

```html
<!-- sp-site-preview:start -->
<script>
(function () {
  if (window.SPSite) return;
  var KIND = { text: 'text', comment: 'text', number: 'number', rating: 'rating', imagerating: 'rating', mediarating: 'rating',
    boolean: 'boolean', consent: 'boolean', imageboolean: 'boolean', mediaboolean: 'boolean',
    radiogroup: 'choice', dropdown: 'choice', imagepicker: 'choice', mediapicker: 'choice',
    checkbox: 'multiChoice', imagecheckbox: 'multiChoice', mediacheckbox: 'multiChoice',
    ranking: 'ranking', imageranking: 'ranking', mediaranking: 'ranking',
    slidergroup: 'sliders', imageslidergroup: 'sliders', mediaslidergroup: 'sliders',
    matrix: 'matrix', imagematrix: 'matrix', mediamatrix: 'matrix',
    pointallocation: 'allocation', imagepointallocation: 'allocation', mediapointallocation: 'allocation',
    imageannotation: 'annotation', html: 'display', expression: 'display', image: 'display', mediadisplay: 'display' };
  var MEDIA_CHOICE = { imagepicker: 'image_', imageranking: 'image_', mediaranking: 'image_', mediapicker: 'media_' };
  var COLORS = ['#8fb3d9', '#d9a38f', '#9fd98f', '#d9cf8f', '#b38fd9', '#8fd9cf'];
  var questions = [], survey = {}, answers = {}, ready = false, waiters = [], lang = 'en', drawn = 0;
  function text(v) { if (v == null) return ''; if (typeof v === 'object') return String(v[lang] || v['default'] || ''); return String(v); }
  function items(list) {
    return (list || []).map(function (c) {
      if (c && typeof c === 'object') return { value: String(c.value != null ? c.value : c.text), text: text(c.text != null ? c.text : c.value) };
      return { value: String(c), text: String(c) };
    });
  }
  function image(label) {
    drawn += 1;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="' + COLORS[drawn % COLORS.length] + '"/><text x="320" y="225" font-size="40" text-anchor="middle" fill="#222" font-family="sans-serif">' + label + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name: 'placeholder_' + drawn + '.jpg', type: 'image' };
  }
  function build(scheme) {
    var s = (scheme && scheme.survey) || scheme || {};
    lang = s.locale || 'en';
    survey = { title: text(s.title), description: text(s.description), language: lang, preview: true };
    (s.pages || []).forEach(function (page) {
      (page.elements || []).forEach(function (el) {
        if (!el || !el.name) return;
        var kind = (el.type === 'text' && el.inputType === 'number') ? 'number' : (KIND[el.type] || 'unsupported');
        var q = { name: el.name, page: page.name || null, type: el.type, kind: kind, title: text(el.title) || el.name,
          description: text(el.description), required: !!el.isRequired, trialCount: Math.max(1, Math.floor(Number(el.trialCount) || 1)) };
        if (kind === 'number') { q.min = el.min != null ? el.min : null; q.max = el.max != null ? el.max : null; }
        if (kind === 'rating') { q.rateMin = Number(el.rateMin != null ? el.rateMin : 1); q.rateMax = Number(el.rateMax != null ? el.rateMax : 5); if (el.rateValues) q.rateValues = items(el.rateValues); else if (el.rateLabels) q.rateValues = el.rateLabels.map(function (t, i) { return { value: q.rateMin + i * (Number(el.rateStep) || 1), text: text(t) }; }); q.minLabel = text(el.minRateDescription); q.maxLabel = text(el.maxRateDescription); }
        if (kind === 'boolean') { q.labelTrue = text(el.labelTrue); q.labelFalse = text(el.labelFalse); }
        if (kind === 'sliders') q.dimensions = (el.dimensions || []).map(function (d) { return { id: String(d.id), label: text(d.label), left: text(d.left), right: text(d.right), min: d.min != null ? d.min : (el.scaleMin != null ? el.scaleMin : 1), max: d.max != null ? d.max : (el.scaleMax != null ? el.scaleMax : 7), step: d.step != null ? d.step : (el.scaleStep || 1) }; });
        if (kind === 'matrix') { q.rows = items(el.rows); q.columns = items(el.columns); }
        if (kind === 'allocation') q.budget = Number(el.budget != null ? el.budget : 100);
        if (kind === 'annotation') { q.tools = el.allowedTools || ['point', 'line', 'polygon', 'bbox']; q.labels = items(el.annotationLabels).map(function (l) { return l.text; }); q.minShapes = el.minAnnotations || 0; q.maxShapes = el.maxAnnotations || 50; }
        var media = /^(image|media)/.test(el.type) ? Number(el.imageCount) || (MEDIA_CHOICE[el.type] ? 4 : 1) : 0;
        function draw(t) { var m = []; for (var i = 0; i < media; i += 1) m.push(image((q.trialCount > 1 ? 'Trial ' + (t + 1) + ' · ' : '') + 'Image ' + (i + 1))); return m; }
        function choicesFor(m) {
          var list;
          if (MEDIA_CHOICE[el.type]) list = m.map(function (x, i) { return { value: MEDIA_CHOICE[el.type] + i, text: x.name, imageUrl: x.url }; });
          else if (/^(choice|multiChoice|ranking|allocation)$/.test(kind)) list = items(el.choices);
          if (list && el.allowTie && el.tieLabel) list.push({ value: String(el.tieLabel), text: String(el.tieLabel), tie: true });
          return list;
        }
        if (q.trialCount > 1) {
          q.trials = [];
          for (var t = 0; t < q.trialCount; t += 1) { var m = draw(t); q.trials.push({ media: m, choices: choicesFor(m) }); }
        } else {
          q.media = draw(0);
          var c = choicesFor(q.media);
          if (c) q.choices = c;
        }
        questions.push(q);
      });
    });
  }
  function find(name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; }
  function panel() {
    var box = document.getElementById('sp-preview-data');
    if (!box) {
      box = document.createElement('details');
      box.id = 'sp-preview-data';
      box.style.cssText = 'position:fixed;right:8px;bottom:8px;max-width:min(420px,90vw);max-height:45vh;overflow:auto;background:#111;color:#9f9;font:12px monospace;border-radius:6px;padding:6px 10px;opacity:.92;z-index:2147483647';
      box.innerHTML = '<summary style="cursor:pointer;color:#fff">SP-Scheme preview · recorded data</summary><pre style="margin:6px 0 0;white-space:pre-wrap"></pre>';
      document.body.appendChild(box);
    }
    box.querySelector('pre').textContent = JSON.stringify(answers, null, 2);
    return box;
  }
  function done(result) { return Promise.resolve(result); }
  window.SPSite = {
    version: 'preview',
    platform: false,
    onReady: function (cb) { if (ready) cb({ questions: questions, survey: survey, answers: answers }); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: find,
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    allowedHosts: [],
    getMedia: function (folder) {
      // On the platform: the files of a survey-level mediaFolders entry. The preview has none.
      var all = (survey && survey.mediaFolders) || [];
      if (folder === undefined) { var out = {}; all.forEach(function (f) { out[f] = []; }); return out; }
      console.warn('[SPSite preview] getMedia(' + folder + '): the preview has no media library; the platform fills this in');
      return [];
    },
    onSubmit: function () { /* the platform hands intercepted result posts here */ },
    onRequest: function () { /* the platform lets the page answer its own requests here */ },
    answer: function (name, value, options) {
      var q = find(name);
      if (!q) { console.warn('[SPSite preview] unknown question', name); return done({ ok: false, error: 'Unknown question "' + name + '"' }); }
      var key = options && options.key, shown = options && options.shown;
      if (key != null || (shown != null && !(q.trialCount > 1 && options.trial != null))) {
        // Page-drawn media: one record per item, replaced when the same key comes again.
        var rec = answers[name] && answers[name].trials ? answers[name] : { trials: [] };
        var list = [].concat(shown == null ? [] : shown).map(String);
        var at = key == null ? -1 : rec.trials.findIndex(function (x) { return x.key === String(key); });
        if (value == null) { if (at >= 0) rec.trials.splice(at, 1); }
        else { var e = { value: value, shown_images: list, shown_media_ids: list }; if (key != null) e.key = String(key); if (at >= 0) rec.trials[at] = e; else rec.trials.push(e); }
        if (rec.trials.length) answers[name] = rec; else delete answers[name];
      } else if (q.trialCount > 1) {
        var t = options && options.trial;
        if (typeof t !== 'number' || t < 0 || t >= q.trialCount) return done({ ok: false, error: name + ' repeats ' + q.trialCount + ' times: pass { trial: 0…' + (q.trialCount - 1) + ' }' });
        var cur = answers[name] || { trials: [] };
        while (cur.trials.length < q.trialCount) cur.trials.push({ value: null, shown_images: [] });
        cur.trials[t] = { value: value == null ? null : value, shown_images: value == null ? [] : q.trials[t].media.map(function (m) { return m.url.slice(0, 40) + '…'; }) };
        answers[name] = cur;
      } else if (value == null) { delete answers[name]; } else { answers[name] = value; }
      panel();
      return done({ ok: true });
    },
    complete: function () {
      var missing = questions.filter(function (q) {
        if (!q.required || q.kind === 'display') return false;
        var v = answers[q.name];
        if (q.trialCount > 1) return !v || v.trials.some(function (x) { return x.value == null; });
        return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
      }).map(function (q) { return q.name; });
      if (missing.length) return done({ ok: false, missing: missing, error: 'Required questions are unanswered: ' + missing.join(', ') });
      var box = panel();
      box.open = true;
      box.querySelector('summary').textContent = 'Preview finished · on SP-Survey these answers are submitted now';
      return done({ ok: true });
    }
  };
  function start() {
    var node = document.getElementById('sp-scheme');
    try { build(JSON.parse(node ? node.textContent : '{}')); } catch (err) { console.error('[SPSite preview] invalid sp-scheme JSON', err); }
    ready = true;
    var d = { questions: questions, survey: survey, answers: answers };
    waiters.splice(0).forEach(function (cb) { cb(d); });
    document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
</script>
<!-- sp-site-preview:end -->
```

## 6. Example index.html

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Street perception study</title>
<script type="application/json" id="sp-scheme">
{
  "format": "sp-scheme-package",
  "spScheme": "2.0",
  "survey": {
    "title": "Street perception study",
    "description": "You will compare street images and rate one scene. About 3 minutes.",
    "locale": "en",
    "pages": [
      {
        "name": "welcome",
        "elements": [
          {
            "type": "consent",
            "name": "consent",
            "title": "I agree to take part in this study",
            "isRequired": true
          }
        ]
      },
      {
        "name": "duel",
        "elements": [
          {
            "type": "imagepicker",
            "name": "safety_duel",
            "title": "Which street feels safer to walk alone at night?",
            "imageCount": 2,
            "trialCount": 3,
            "imageSelectionMode": "huggingface_random",
            "randomImageSelection": true,
            "excludePreviouslyUsedImages": true,
            "choices": [],
            "isRequired": true
          }
        ]
      },
      {
        "name": "scales",
        "elements": [
          {
            "type": "imageslidergroup",
            "name": "scene_scales",
            "title": "How does this street feel?",
            "imageCount": 1,
            "imageSelectionMode": "huggingface_random",
            "randomImageSelection": true,
            "excludePreviouslyUsedImages": true,
            "scaleMin": 1,
            "scaleMax": 7,
            "dimensions": [
              {
                "id": "safety",
                "label": "Safety",
                "left": "Very unsafe",
                "right": "Very safe"
              },
              {
                "id": "lively",
                "label": "Liveliness",
                "left": "Dull",
                "right": "Lively"
              }
            ],
            "isRequired": true
          }
        ]
      }
    ]
  }
}
</script>
<!-- sp-site-preview:start -->
<script>
(function () {
  if (window.SPSite) return;
  var KIND = { text: 'text', comment: 'text', number: 'number', rating: 'rating', imagerating: 'rating', mediarating: 'rating',
    boolean: 'boolean', consent: 'boolean', imageboolean: 'boolean', mediaboolean: 'boolean',
    radiogroup: 'choice', dropdown: 'choice', imagepicker: 'choice', mediapicker: 'choice',
    checkbox: 'multiChoice', imagecheckbox: 'multiChoice', mediacheckbox: 'multiChoice',
    ranking: 'ranking', imageranking: 'ranking', mediaranking: 'ranking',
    slidergroup: 'sliders', imageslidergroup: 'sliders', mediaslidergroup: 'sliders',
    matrix: 'matrix', imagematrix: 'matrix', mediamatrix: 'matrix',
    pointallocation: 'allocation', imagepointallocation: 'allocation', mediapointallocation: 'allocation',
    imageannotation: 'annotation', html: 'display', expression: 'display', image: 'display', mediadisplay: 'display' };
  var MEDIA_CHOICE = { imagepicker: 'image_', imageranking: 'image_', mediaranking: 'image_', mediapicker: 'media_' };
  var COLORS = ['#8fb3d9', '#d9a38f', '#9fd98f', '#d9cf8f', '#b38fd9', '#8fd9cf'];
  var questions = [], survey = {}, answers = {}, ready = false, waiters = [], lang = 'en', drawn = 0;
  function text(v) { if (v == null) return ''; if (typeof v === 'object') return String(v[lang] || v['default'] || ''); return String(v); }
  function items(list) {
    return (list || []).map(function (c) {
      if (c && typeof c === 'object') return { value: String(c.value != null ? c.value : c.text), text: text(c.text != null ? c.text : c.value) };
      return { value: String(c), text: String(c) };
    });
  }
  function image(label) {
    drawn += 1;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="' + COLORS[drawn % COLORS.length] + '"/><text x="320" y="225" font-size="40" text-anchor="middle" fill="#222" font-family="sans-serif">' + label + '</text></svg>';
    return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), name: 'placeholder_' + drawn + '.jpg', type: 'image' };
  }
  function build(scheme) {
    var s = (scheme && scheme.survey) || scheme || {};
    lang = s.locale || 'en';
    survey = { title: text(s.title), description: text(s.description), language: lang, preview: true };
    (s.pages || []).forEach(function (page) {
      (page.elements || []).forEach(function (el) {
        if (!el || !el.name) return;
        var kind = (el.type === 'text' && el.inputType === 'number') ? 'number' : (KIND[el.type] || 'unsupported');
        var q = { name: el.name, page: page.name || null, type: el.type, kind: kind, title: text(el.title) || el.name,
          description: text(el.description), required: !!el.isRequired, trialCount: Math.max(1, Math.floor(Number(el.trialCount) || 1)) };
        if (kind === 'number') { q.min = el.min != null ? el.min : null; q.max = el.max != null ? el.max : null; }
        if (kind === 'rating') { q.rateMin = Number(el.rateMin != null ? el.rateMin : 1); q.rateMax = Number(el.rateMax != null ? el.rateMax : 5); if (el.rateValues) q.rateValues = items(el.rateValues); else if (el.rateLabels) q.rateValues = el.rateLabels.map(function (t, i) { return { value: q.rateMin + i * (Number(el.rateStep) || 1), text: text(t) }; }); q.minLabel = text(el.minRateDescription); q.maxLabel = text(el.maxRateDescription); }
        if (kind === 'boolean') { q.labelTrue = text(el.labelTrue); q.labelFalse = text(el.labelFalse); }
        if (kind === 'sliders') q.dimensions = (el.dimensions || []).map(function (d) { return { id: String(d.id), label: text(d.label), left: text(d.left), right: text(d.right), min: d.min != null ? d.min : (el.scaleMin != null ? el.scaleMin : 1), max: d.max != null ? d.max : (el.scaleMax != null ? el.scaleMax : 7), step: d.step != null ? d.step : (el.scaleStep || 1) }; });
        if (kind === 'matrix') { q.rows = items(el.rows); q.columns = items(el.columns); }
        if (kind === 'allocation') q.budget = Number(el.budget != null ? el.budget : 100);
        if (kind === 'annotation') { q.tools = el.allowedTools || ['point', 'line', 'polygon', 'bbox']; q.labels = items(el.annotationLabels).map(function (l) { return l.text; }); q.minShapes = el.minAnnotations || 0; q.maxShapes = el.maxAnnotations || 50; }
        var media = /^(image|media)/.test(el.type) ? Number(el.imageCount) || (MEDIA_CHOICE[el.type] ? 4 : 1) : 0;
        function draw(t) { var m = []; for (var i = 0; i < media; i += 1) m.push(image((q.trialCount > 1 ? 'Trial ' + (t + 1) + ' · ' : '') + 'Image ' + (i + 1))); return m; }
        function choicesFor(m) {
          var list;
          if (MEDIA_CHOICE[el.type]) list = m.map(function (x, i) { return { value: MEDIA_CHOICE[el.type] + i, text: x.name, imageUrl: x.url }; });
          else if (/^(choice|multiChoice|ranking|allocation)$/.test(kind)) list = items(el.choices);
          if (list && el.allowTie && el.tieLabel) list.push({ value: String(el.tieLabel), text: String(el.tieLabel), tie: true });
          return list;
        }
        if (q.trialCount > 1) {
          q.trials = [];
          for (var t = 0; t < q.trialCount; t += 1) { var m = draw(t); q.trials.push({ media: m, choices: choicesFor(m) }); }
        } else {
          q.media = draw(0);
          var c = choicesFor(q.media);
          if (c) q.choices = c;
        }
        questions.push(q);
      });
    });
  }
  function find(name) { for (var i = 0; i < questions.length; i += 1) if (questions[i].name === name) return questions[i]; return null; }
  function panel() {
    var box = document.getElementById('sp-preview-data');
    if (!box) {
      box = document.createElement('details');
      box.id = 'sp-preview-data';
      box.style.cssText = 'position:fixed;right:8px;bottom:8px;max-width:min(420px,90vw);max-height:45vh;overflow:auto;background:#111;color:#9f9;font:12px monospace;border-radius:6px;padding:6px 10px;opacity:.92;z-index:2147483647';
      box.innerHTML = '<summary style="cursor:pointer;color:#fff">SP-Scheme preview · recorded data</summary><pre style="margin:6px 0 0;white-space:pre-wrap"></pre>';
      document.body.appendChild(box);
    }
    box.querySelector('pre').textContent = JSON.stringify(answers, null, 2);
    return box;
  }
  function done(result) { return Promise.resolve(result); }
  window.SPSite = {
    version: 'preview',
    platform: false,
    onReady: function (cb) { if (ready) cb({ questions: questions, survey: survey, answers: answers }); else waiters.push(cb); },
    getQuestions: function () { return questions; },
    getQuestion: find,
    getSurvey: function () { return survey; },
    getAnswers: function () { return answers; },
    allowedHosts: [],
    getMedia: function (folder) {
      // On the platform: the files of a survey-level mediaFolders entry. The preview has none.
      var all = (survey && survey.mediaFolders) || [];
      if (folder === undefined) { var out = {}; all.forEach(function (f) { out[f] = []; }); return out; }
      console.warn('[SPSite preview] getMedia(' + folder + '): the preview has no media library; the platform fills this in');
      return [];
    },
    onSubmit: function () { /* the platform hands intercepted result posts here */ },
    onRequest: function () { /* the platform lets the page answer its own requests here */ },
    answer: function (name, value, options) {
      var q = find(name);
      if (!q) { console.warn('[SPSite preview] unknown question', name); return done({ ok: false, error: 'Unknown question "' + name + '"' }); }
      var key = options && options.key, shown = options && options.shown;
      if (key != null || (shown != null && !(q.trialCount > 1 && options.trial != null))) {
        // Page-drawn media: one record per item, replaced when the same key comes again.
        var rec = answers[name] && answers[name].trials ? answers[name] : { trials: [] };
        var list = [].concat(shown == null ? [] : shown).map(String);
        var at = key == null ? -1 : rec.trials.findIndex(function (x) { return x.key === String(key); });
        if (value == null) { if (at >= 0) rec.trials.splice(at, 1); }
        else { var e = { value: value, shown_images: list, shown_media_ids: list }; if (key != null) e.key = String(key); if (at >= 0) rec.trials[at] = e; else rec.trials.push(e); }
        if (rec.trials.length) answers[name] = rec; else delete answers[name];
      } else if (q.trialCount > 1) {
        var t = options && options.trial;
        if (typeof t !== 'number' || t < 0 || t >= q.trialCount) return done({ ok: false, error: name + ' repeats ' + q.trialCount + ' times: pass { trial: 0…' + (q.trialCount - 1) + ' }' });
        var cur = answers[name] || { trials: [] };
        while (cur.trials.length < q.trialCount) cur.trials.push({ value: null, shown_images: [] });
        cur.trials[t] = { value: value == null ? null : value, shown_images: value == null ? [] : q.trials[t].media.map(function (m) { return m.url.slice(0, 40) + '…'; }) };
        answers[name] = cur;
      } else if (value == null) { delete answers[name]; } else { answers[name] = value; }
      panel();
      return done({ ok: true });
    },
    complete: function () {
      var missing = questions.filter(function (q) {
        if (!q.required || q.kind === 'display') return false;
        var v = answers[q.name];
        if (q.trialCount > 1) return !v || v.trials.some(function (x) { return x.value == null; });
        return v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
      }).map(function (q) { return q.name; });
      if (missing.length) return done({ ok: false, missing: missing, error: 'Required questions are unanswered: ' + missing.join(', ') });
      var box = panel();
      box.open = true;
      box.querySelector('summary').textContent = 'Preview finished · on SP-Survey these answers are submitted now';
      return done({ ok: true });
    }
  };
  function start() {
    var node = document.getElementById('sp-scheme');
    try { build(JSON.parse(node ? node.textContent : '{}')); } catch (err) { console.error('[SPSite preview] invalid sp-scheme JSON', err); }
    ready = true;
    var d = { questions: questions, survey: survey, answers: answers };
    waiters.splice(0).forEach(function (cb) { cb(d); });
    document.dispatchEvent(new CustomEvent('spsite-ready', { detail: d }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
</script>
<!-- sp-site-preview:end -->
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
  main { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
  h1, h2 { line-height: 1.25; }
  .duel { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .duel button { padding: 0; border: 4px solid transparent; border-radius: 12px; background: none; cursor: pointer; }
  .duel button:hover, .duel button:focus-visible { border-color: #38bdf8; outline: none; }
  img { width: 100%; display: block; border-radius: 8px; }
  .btn { margin-top: 16px; padding: 12px 20px; border: 0; border-radius: 999px; background: #38bdf8; color: #0f172a; font-size: 16px; font-weight: 700; cursor: pointer; }
  .scale { margin: 18px 0; }
  .scale input { width: 100%; }
  .poles { display: flex; justify-content: space-between; font-size: 13px; opacity: .8; }
  .error { color: #fca5a5; min-height: 1.2em; }
</style>
</head>
<body>
<main id="app"><p>Loading…</p></main>
<script>
SPSite.onReady(function (ctx) {
  var app = document.getElementById('app');
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
  var screens = [welcome, duel, scales];
  var screen = 0;
  var trial = 0;
  function next() { screen += 1; trial = 0; if (screen < screens.length) screens[screen](); }

  function welcome() {
    var q = SPSite.getQuestion('consent');
    app.innerHTML = '<h1>' + esc(ctx.survey.title) + '</h1><p>' + esc(ctx.survey.description) + '</p>'
      + '<label><input type="checkbox" id="agree"> ' + esc(q.title) + '</label><br>'
      + '<button class="btn" id="go">Start</button><p class="error" id="err"></p>';
    document.getElementById('go').onclick = function () {
      if (!document.getElementById('agree').checked) { document.getElementById('err').textContent = 'Please agree to continue.'; return; }
      SPSite.answer('consent', true).then(function (r) { if (r.ok) next(); });
    };
  }

  function duel() {
    var q = SPSite.getQuestion('safety_duel');
    var round = q.trials[trial];
    app.innerHTML = '<h2>' + esc(q.title) + '</h2><p>Round ' + (trial + 1) + ' of ' + q.trialCount + '</p><div class="duel"></div>';
    round.choices.forEach(function (choice, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<img alt="Street ' + (i + 1) + '" src="' + choice.imageUrl + '">';
      b.onclick = function () {
        SPSite.answer('safety_duel', choice.value, { trial: trial }).then(function (r) {
          if (!r.ok) return;
          trial += 1;
          if (trial < q.trialCount) duel(); else next();
        });
      };
      app.querySelector('.duel').appendChild(b);
    });
  }

  function scales() {
    var q = SPSite.getQuestion('scene_scales');
    var values = {};
    app.innerHTML = '<h2>' + esc(q.title) + '</h2><img alt="Street" src="' + q.media[0].url + '"><div id="dims"></div>'
      + '<button class="btn" id="finish">Finish</button><p class="error" id="err"></p>';
    q.dimensions.forEach(function (d) {
      var mid = Math.round((d.min + d.max) / 2);
      values[d.id] = mid;
      var row = document.createElement('div');
      row.className = 'scale';
      row.innerHTML = '<strong>' + esc(d.label) + '</strong><input type="range" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + mid + '">'
        + '<div class="poles"><span>' + esc(d.left) + '</span><span>' + esc(d.right) + '</span></div>';
      row.querySelector('input').oninput = function (e) { values[d.id] = Number(e.target.value); };
      document.getElementById('dims').appendChild(row);
    });
    document.getElementById('finish').onclick = function () {
      SPSite.answer('scene_scales', values)
        .then(function (r) { if (!r.ok) throw new Error(r.error); return SPSite.complete(); })
        .then(function (r) {
          if (!r.ok) { document.getElementById('err').textContent = r.error; return; }
          app.innerHTML = '<h2>Submitting…</h2>';
        })
        .catch(function (err) { document.getElementById('err').textContent = err.message; });
    };
  }

  welcome();
});
</script>
</body>
</html>
```

## 7. Self-check before handing over

1. The researcher has tried the page and confirmed; you are handing over that same page.
2. index.html contains the `<script type="application/json" id="sp-scheme">` block with `format`, `spScheme`, `survey.pages`, and the preview shim right after it.
3. Every recorded answer has a declared question (a native type when the value fits, otherwise `custom`); names are unique; required questions have `isRequired: true`.
4. No media URLs in the JSON or the page; every image or clip participants judge comes from `question.media` / `question.trials[i].media` or from `SPSite.getMedia(folder)`.
5. Every answer goes through `SPSite.answer(name, value)` (with `{ trial }` for platform-drawn rounds, or `{ key, shown }` when the page draws media itself) in the shape of its kind, and the end calls `SPSite.complete()`.
6. Questions the platform cannot analyse are declared as `custom`, not squeezed into a native type.
7. No network calls, external scripts outside the allowed hosts, or credentials.
