/**
 * Write the analysis code for one Results question with the Assistant model
 * (the free route when the user has no key of their own).
 *
 * The model returns one JavaScript function, analyze(records, helpers). The
 * browser runs it in a sandbox and the platform computes the statistics on
 * the blocks it returns, so nothing the model writes touches the app or the
 * network, and the numbers come from the platform's own algorithms.
 */

import { usageMeter } from './usageLog.mjs';

const MAX_QUESTION_CHARS = 4000;
const MAX_SAMPLE_CHARS = 16000;
const MAX_FIELDS_CHARS = 12000;
const MAX_CODE_CHARS = 40000;

export const ANALYSIS_SYSTEM_PROMPT = `You write the analysis for ONE question of a perception survey on SP-Survey.
The page usually has several questions and the records hold the data of all of them. Analyse ONLY the QUESTION given.
OTHER QUESTIONS lists the rest: their data is in the same records, leave it alone (e.g. if the page saves answers per task, read only this question's task).
Write ONE JavaScript function:

function analyze(records, helpers) {
  // ...
  return { blocks: [ ... ] };
}

records: one object per participant submission:
  { participant_id, submitted_at,
    answer,      // what the platform stored for this question (may be missing)
    shown,       // media shown with the answer (may be missing)
    page_state,  // what the survey page saved in its own storage, by storage key (may be missing)
    requests }   // what the page sent: [{ at, method, url, data }] (may be missing)
FIELDS lists every field path in the records, its types and how many records have it. Use those exact paths.
Type "json-string" means the value is a JSON string: parse it first (helpers.parse, or helpers.get which parses on the way); the paths below it are inside the parsed value. In SAMPLE RECORDS such a value is shown as {"(JSON string — helpers.parse it)": parsed}; that wrapper key is NOT in the real data.

helpers (already defined):
  helpers.parse(v)      JSON.parse a string, else return v
  helpers.list(v)       v as an array (array, object values, or [v]; [] for null)
  helpers.num(v)        number or null
  helpers.get(obj, "a.b.c")  safe nested read (parses JSON strings on the way)
  helpers.file(url)     file name of a URL or path ("https://x/images/IMG1.jpg?x=1" -> "IMG1.jpg")
  helpers.flat(arr)     flatten one level
  helpers.media(r, name?)  the media library images the platform put into the page's own list for record r: [{ name, url, folder }] in order ([] if none)

Return blocks. You only reshape data; SP-Survey runs the statistics:
  { type: "per_item", title, values: [{ item, value, rater }], measure?: "category"|"number", labels?: { value: "label" } }
      one entry per answer about one image/item: item = the image (helpers.file(url) or its name), value = the answer, rater = r.participant_id.
      Use for: each image rated or classified on its own (Likert score, 0/1/2 category, yes/no). SP-Survey summarises per image
      (mean, or counts and majority), the overall distribution, and agreement across raters (Krippendorff's alpha).
      Use measure "category" for codes or options (labels give their text from the question), "number" for scores.
  { type: "pairwise", title, matches: [{ winner, loser, category? }] }
      one match per A-vs-B decision (winner = chosen item, loser = the other). SP-Survey ranks items with TrueSkill.
      Use for: forced choice between two images/options, "which is more X", best-of-N (chosen beats each other shown item).
  { type: "ranking", title, orders: [[best, second, ..., worst], ...] }
      one complete order per participant or trial. SP-Survey computes TrueSkill, Borda score and Kendall's W.
  { type: "choice", title, values: [option, option, ...], total? }
      one value per answer (for multi-select push each selected option and set total = number of answers). SP-Survey counts and gives Wilson 95% intervals.
  { type: "rating", title, values: [numbers] }  or  { type: "rating", title, items: [{ label, values: [numbers] }], min?, max? }
      numeric answers (Likert, slider, scores), per item if each image/item was rated. SP-Survey gives mean, SD, median, 95% CI.
  { type: "text", title, values: [strings] }
      free text. SP-Survey gives word frequency and lengths.
  { type: "bar", title, items: [{ label, value }], unit? }
  { type: "table", title, columns: [..], rows: [[..], ..] }
      anything else you compute yourself (e.g. mean reaction time per condition, accuracy per block).
  { type: "note", text }   one short sentence on what you assumed.
Every block may have a short "note".

Rules:
- If ALREADY ANALYSED BY THE PLATFORM is given, those analyses are shown already: do NOT repeat them (no pairwise or per_item block on the same answers).
  Your job is what is missing: the fields it lists as skipped because it could not read them (complex structures such as hotspot clicks,
  nested logic, conditional branches; not image names, time stamps or order numbers), and anything RESEARCHER NOTES ask for.
  If nothing is missing, return { blocks: [] }.
- Read the QUESTION to decide what the answer means, then pick the ONE block type that fits it. Usually one block; at most 3, all about this question.
- Images: participants usually see a random subset of images in a random order. Results must be keyed by WHICH image (its file name), never by trial number or position. MEDIA says where image names appear. Use helpers.file(url) as the item so the platform can show the picture.
- Use the question's own options (choices) as labels when the answer is a code.
- Where the page named its own items (e.g. scene ids "S03") but took the pictures by position from the media library list it was given, the platform has ALREADY replaced those ids with the library image names in the records (each participant's list is in a random order). Use the names as they appear; never translate ids yourself. Ids that are still there had no library image.
- If the page uses several conditions or dimensions for the same task (e.g. a "dim" field), split by it: pairwise "category", or one block per dimension (still at most 3).
- Skip records or trials that lack the data; never throw. Guard every access: (x || {}), Array.isArray(...).
- Plain modern JavaScript only. No fetch, no DOM, no imports, no async, no Math.random.
- Reply with the function in one \`\`\`javascript block and nothing else.`;

export const PLAN_SYSTEM_PROMPT = `You read ONE question of a perception survey on SP-Survey and say what each stored field means, so the platform can analyse it.
The page stored one object per answer (or per trial); FIELDS lists every path in those objects. Do not write code. Reply with ONE JSON object:

{
  "summary": "one sentence: what the participant does in this question, in the survey's own language",
  "fields": [
    { "path": "<path exactly as in FIELDS>", "use": "<one of the uses below>", "meaning": "<what it is, in the survey's own words, e.g. 街景 A 的安全感评分（1–5）>", ...extras }
  ]
}

Uses (pick the one that fits what the field holds):
  "image"    the name/URL of an image (stimulus) shown. meaning: which one (e.g. 街景 A).
  "score"    a number the participant gave (Likert, slider). extras: "image": <image field this score is about> (if any),
             "item": <field naming the scale/item when several scores sit in a list, e.g. result.ratings[].itemId>,
             "measure": <short name shared by scores of the same kind for different images, e.g. 安全感评分>, "scale": { "1": "很不安全", "5": "很安全" } (from the page/question).
  "pick"     a choice BETWEEN two or more shown images (which is safer, left/right, A/B). extras: "images": [image fields chosen between],
             "options": { "<stored value>": { "label": "<option text>", "picks": "<image field>" or null for similar/can't tell } }.
  "option"   a single choice that is not between images (yes/no, category, condition). extras: "options": { "<value>": "<label>" } if the page has labels.
  "tags"     a multi-select list (reasons, keywords). extras: "image": <image field it describes> (if any), "measure": <shared name for the same tag list on different images>.
  "group"    a participant attribute or design condition (grade, gender, age, occupation, AB order). The platform lists these in ONE background table (counts, or mean for numbers).
             Add "compare": true ONLY when RESEARCHER NOTES ask to compare results by it (e.g. 按年级比较); never on your own. Context fields (@grade) are answers to the other questions of the same submission.
  "duration" time spent, in ms or s. extras: "unit": "ms" | "s".
  "time"     a time stamp (startedAt, savedAt).
  "text"     free text.
  "skip"     bookkeeping that is not an answer: ids, seeds, hashes, order/round numbers, version flags, lists of what was shown, containers whose fields are listed separately. extras: "why".
  "custom"   an answer the uses above cannot express (clicks/hotspot coordinates, drawn shapes, nested branching). extras: "why". The platform will ask you for code for these afterwards.

Rules:
- EVERY path in FIELDS gets an entry (containers may be covered by their own fields). Nothing may be left out: a field you do not list will be sent back to you.
- Use the question text, OTHER QUESTIONS and PAGE CODE (option arrays like { value: 'a_safer', label: 'A 更安全' }, RATE scales) to write meanings, labels and scales in the survey's own language. Never invent labels that are not in the page or question.
- A score or tag list about one image says which image field it belongs to (ratingA → imageA). Scores of the same kind for different images share one "measure".
- Fields fixed per participant that describe the person (grade, gender, age group, experimental group/order) are "group"; fields like round, trial index, savedAt, seeds, shown lists are "skip"/"time".
- A string that holds JSON (its inner fields are listed below it as path{json}.…) is a container: "skip". When the same information is stored twice (a JSON copy and a plain object; a nested and a flat copy of the same ratings), analyse one and mark the other "skip" with why "重复".
- When each image gets several scores stored as separate fields (scenes[].ratings.A1, scenes[].ratings.M1, …), give them the SAME measure and the SAME image field, each with its own meaning (the item text); the platform then makes one image × item table.
- Reply with the JSON in one \`\`\`json block and nothing else.`;

function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function normalizeAnalysisRequest(body) {
  const question = clip(body?.question, MAX_QUESTION_CHARS).trim();
  const sample = clip(body?.sample, MAX_SAMPLE_CHARS);
  const fields = clip(body?.fields, MAX_FIELDS_CHARS);
  if (!question) throw Object.assign(new Error('question is required'), { status: 400, code: 'BAD_REQUEST' });
  if (!sample.trim()) throw Object.assign(new Error('sample records are required'), { status: 400, code: 'BAD_REQUEST' });
  return {
    mode: body?.mode === 'plan' ? 'plan' : 'code',
    question,
    sample,
    fields,
    recordCount: Math.max(0, Math.floor(Number(body?.recordCount) || 0)),
    instructions: clip(body?.instructions, 2000).trim(),
    otherQuestions: clip(body?.otherQuestions, 6000).trim(),
    media: clip(body?.media, 3000).trim(),
    pageCode: clip(body?.pageCode, 6000).trim(),
    platformDone: clip(body?.platformDone, 4000).trim(),
    previous: clip(body?.previous, MAX_CODE_CHARS),
    error: clip(body?.error, 3000).trim(),
  };
}

/** The JSON plan from the model's answer, or null. */
export function parsePlanAnswer(text) {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = [...raw.matchAll(/```(?:json)?[^\n]*\n([\s\S]*?)(?:```|$)/gi)].map((m) => m[1].trim());
  const candidates = [...fenced, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.fields) || Array.isArray(parsed))) return parsed;
    } catch { /* next */ }
  }
  return null;
}

/** The function from the model's answer, or null. */
export function parseAnalysisAnswer(text) {
  const raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const blocks = [...raw.matchAll(/```([a-z]*)[^\n]*\n([\s\S]*?)(?:```|$)/gi)].map((m) => ({ lang: m[1].toLowerCase(), body: m[2].trim() }));
  const code = blocks.find((b) => /^(javascript|js)$/.test(b.lang) && /function\s+analyze\s*\(/.test(b.body))
    || blocks.find((b) => /function\s+analyze\s*\(/.test(b.body))
    || (/function\s+analyze\s*\(/.test(raw) ? { body: raw.slice(raw.search(/function\s+analyze\s*\(/)) } : null);
  if (!code?.body) return null;
  return code.body.slice(0, MAX_CODE_CHARS);
}

export function buildAnalysisUserMessage(input) {
  const parts = [`QUESTION\n${input.question}`];
  if (input.otherQuestions) parts.push(`OTHER QUESTIONS ON THE PAGE (do not analyse these)\n${input.otherQuestions}`);
  if (input.media) parts.push(`MEDIA\n${input.media}`);
  if (input.pageCode) parts.push(`PAGE CODE (excerpt of the page's or task's script: how it draws its media and how it records the answers; use it to read what the fields mean)\n${input.pageCode}`);
  if (input.platformDone) parts.push(`ALREADY ANALYSED BY THE PLATFORM (shown already; do not repeat)\n${input.platformDone}`);
  if (input.instructions) parts.push(`RESEARCHER NOTES (follow these)\n${input.instructions}`);
  parts.push(`RECORDS: ${input.recordCount || 'several'} in total`);
  if (input.fields) parts.push(`FIELDS (path  types  (records having it)  example)\n${input.fields}`);
  parts.push(`SAMPLE RECORDS (shortened: long arrays and strings are cut)\n${input.sample}`);
  if (input.previous && input.mode === 'plan') {
    parts.push(`YOUR PREVIOUS PLAN\n\`\`\`json\n${input.previous}\n\`\`\``);
    parts.push(`IT IS INCOMPLETE\n${input.error || 'Some fields are missing.'}\nReturn the WHOLE corrected plan with every field.`);
  } else if (input.previous) {
    parts.push(`YOUR PREVIOUS CODE\n\`\`\`javascript\n${input.previous}\n\`\`\``);
    parts.push(`IT FAILED ON THE REAL RECORDS\n${input.error || 'It returned no usable blocks.'}\nFix it. Return the whole corrected function.`);
  }
  return parts.join('\n\n');
}

export async function handleResultsAiAnalysis(env, userId, body, deps = {}) {
  const input = normalizeAnalysisRequest(body);

  const credentials = deps.loadUserAiSettings ? null : await import('./credentials.mjs');
  const loadSettings = deps.loadUserAiSettings || credentials.loadUserAiSettings;
  const listProfiles = deps.listProviderProfiles || credentials.listProviderProfiles;
  const resolveBinding = deps.resolveAssistantBinding || credentials.resolveAssistantBinding;
  const settings = await loadSettings(env, userId);
  const profiles = await listProfiles(env, userId);
  const provider = settings.assistant_provider || settings.default_provider || 'deepseek';
  const profile = profiles.find((row) => row.provider === provider) || {};
  const binding = await resolveBinding(env, userId, provider, settings.assistant_model || '', { receiverProfiles: profiles });
  const credential = binding?.credential;
  if (!credential?.apiKey) {
    throw Object.assign(new Error('No Assistant model is available. Add a model and key in AI & Integrations.'), {
      status: 400,
      code: 'CREDENTIALS_MISSING',
    });
  }
  const registry = deps.registry || await import('./runtime/registry.mjs');
  const validators = deps.validators || await import('./runtime/validators.mjs');
  const chat = deps.chatCompletions || (await import('./runtime/providers.mjs')).chatCompletions;
  const model = registry.availableModelId(provider, settings.assistant_model, { profile });
  const checked = validators.assertRoute({ provider, model, profile, requireConfigured: true, credential });
  const modelRecord = registry.resolveModel(provider, model, profile);

  const result = await chat({
    apiKey: credential.apiKey,
    provider,
    baseUrl: checked.route.baseUrl,
    model,
    modelRecord,
    protocol: checked.route.protocol,
    compat: modelRecord?.compat,
    extra: checked.route.headers,
    meter: usageMeter(env, { userId, binding, feature: 'results-analysis', projectId: body?.projectId || null }),
    temperature: 0.1,
    maxTokens: Math.min(Number(modelRecord?.maxTokens) || 8192, 8192),
    messages: [
      { role: 'system', content: input.mode === 'plan' ? PLAN_SYSTEM_PROMPT : ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: buildAnalysisUserMessage(input) },
    ],
  });
  if (input.mode === 'plan') {
    const plan = parsePlanAnswer(result?.content);
    if (!plan) {
      const head = String(result?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      throw Object.assign(new Error(`The model did not return a JSON plan${head ? ` (it began: "${head}")` : ' (its answer was empty)'}.`), { status: 502, code: 'ANALYSIS_UNPARSEABLE' });
    }
    return { success: true, provider, model, plan };
  }
  const code = parseAnalysisAnswer(result?.content);
  if (!code) {
    const head = String(result?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    throw Object.assign(new Error(`The model did not return an analyze() function${head ? ` (it began: "${head}")` : ' (its answer was empty)'}.`), {
      status: 502,
      code: 'ANALYSIS_UNPARSEABLE',
    });
  }
  return { success: true, provider, model, code };
}
