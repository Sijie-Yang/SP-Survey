/**
 * Qualtrics survey file (.qsf) → SP-Survey surveyConfig. Deterministic: the
 * common question types are mapped one-to-one, everything else is listed in
 * the report so the researcher knows exactly what to rebuild by hand.
 *
 *   MC single / multiple / dropdown / NPS → radiogroup / checkbox / dropdown / rating 0–10
 *   Matrix (Likert, bipolar)              → matrix
 *   Slider                                → slidergroup (one dimension per statement)
 *   Text entry (single / multi / form)    → text or number / comment / one text per field
 *   Rank order                            → ranking
 *   Constant sum                          → pointallocation
 *   Descriptive text                      → expression (plain text)
 *
 * Not converted (listed in the report): display/skip logic, randomizers and
 * branches, piped text, embedded data, quotas, images inside question text,
 * and question types without a native equivalent (heat map, hot spot, draw,
 * file upload, signature, side-by-side, timing, meta info, captcha …).
 */

export const QSF_IMPORT_VERSION = '1.0.0';

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** Qualtrics HTML → readable plain text. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => {
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
  return [];
}

function ordered(map, order) {
  const obj = map && typeof map === 'object' ? map : {};
  const keys = Array.isArray(order) && order.length ? order.map(String) : Object.keys(obj).sort((a, b) => Number(a) - Number(b));
  return keys.filter((k) => obj[k]).map((k) => ({ id: k, ...obj[k] }));
}

function choiceItems(payload, map = payload.Choices, order = payload.ChoiceOrder, recode = payload.RecodeValues) {
  return ordered(map, order).map((c) => ({
    value: String(recode?.[c.id] ?? c.id),
    text: htmlToText(c.Display) || String(c.id),
  }));
}

function makeNamer() {
  const used = new Set();
  return (raw, fallback) => {
    let base = String(raw || fallback || 'q').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'q';
    if (/^\d/.test(base)) base = `q_${base}`;
    let name = base;
    for (let i = 2; used.has(name); i += 1) name = `${base}_${i}`;
    used.add(name);
    return name;
  };
}

/** Block ids in survey-flow order, plus notes about branches / randomizers. */
function flowBlockIds(elements, blocks, notes) {
  const fl = elements.find((e) => e.Element === 'FL')?.Payload;
  const ids = [];
  const walk = (items) => {
    for (const item of asList(items)) {
      if (!item) continue;
      if (item.Type === 'Block' || item.Type === 'Standard' || item.Type === 'Default') {
        if (item.ID) ids.push(item.ID);
      } else if (item.Type === 'Branch') {
        notes.add('branch');
      } else if (item.Type === 'BlockRandomizer' || item.Type === 'Randomizer') {
        notes.add('randomizer');
      } else if (item.Type === 'EmbeddedData') {
        notes.add('embedded_data');
      } else if (item.Type === 'EndSurvey') {
        notes.add('end_survey');
      }
      if (item.Flow) walk(item.Flow);
    }
  };
  if (fl?.Flow) walk(fl.Flow);
  if (ids.length) return [...new Set(ids)];
  return blocks.filter((b) => b.Type !== 'Trash').map((b) => b.ID);
}

function isRequired(p) {
  return p?.Validation?.Settings?.ForceResponse === 'ON';
}

/** One Qualtrics question → zero or more SP-Survey elements, or { skip: reason }. */
function convertQuestion(p, name, notes, nextName) {
  const title = htmlToText(p.QuestionText) || p.DataExportTag || p.QuestionID;
  const base = { name, title, ...(isRequired(p) ? { isRequired: true } : {}) };
  const type = p.QuestionType;
  const sel = p.Selector;
  if (/<img\b/i.test(String(p.QuestionText || ''))) notes.add('images_in_text');
  if (/\$\{[^}]+\}/.test(String(p.QuestionText || ''))) notes.add('piped_text');
  if (p.DisplayLogic) notes.add('display_logic');
  if (p.SkipLogic) notes.add('skip_logic');
  if (p.Randomization && p.Randomization.Type && p.Randomization.Type !== 'None') notes.add('choice_randomization');

  if (type === 'DB') return [{ type: 'expression', name, title }];

  if (type === 'MC') {
    if (sel === 'NPS') return [{ ...base, type: 'rating', rateMin: 0, rateMax: 10, minRateDescription: 'Not at all likely', maxRateDescription: 'Extremely likely' }];
    const choices = choiceItems(p);
    if (!choices.length) return { skip: 'no choices' };
    if (ordered(p.Choices, p.ChoiceOrder).some((c) => c.TextEntry === 'true' || c.TextEntry === true)) notes.add('choice_text_entry');
    if (/^MA/.test(sel || '') || sel === 'MSB') return [{ ...base, type: 'checkbox', choices }];
    if (sel === 'DL' || sel === 'SB') return [{ ...base, type: 'dropdown', choices }];
    return [{ ...base, type: 'radiogroup', choices, ...(sel === 'SAHR' ? { colCount: Math.min(choices.length, 5) } : {}) }];
  }

  if (type === 'Matrix') {
    if (sel === 'TE' || sel === 'CS' || sel === 'RO' || sel === 'MaxDiff') return { skip: `matrix (${sel}) has no native equivalent` };
    // Statements are rows; recode values belong to the scale points (columns).
    const rows = choiceItems(p, p.Choices, p.ChoiceOrder, null);
    const columns = choiceItems(p, p.Answers, p.AnswerOrder, p.RecodeValues);
    if (!rows.length || !columns.length) return { skip: 'matrix without rows or columns' };
    if (p.SubSelector === 'MultipleAnswer') notes.add('matrix_multiple_answer');
    return [{ ...base, type: 'matrix', rows, columns }];
  }

  if (type === 'Slider') {
    const cfg = p.Configuration || {};
    const min = Number.isFinite(Number(cfg.CSSliderMin)) ? Number(cfg.CSSliderMin) : 0;
    const max = Number.isFinite(Number(cfg.CSSliderMax)) ? Number(cfg.CSSliderMax) : 100;
    const labels = asList(p.Labels).map((l) => htmlToText(l?.Display)).filter(Boolean);
    const left = labels[0] || String(min);
    const right = labels[labels.length - 1] || String(max);
    const items = ordered(p.Choices, p.ChoiceOrder);
    const dimensions = (items.length ? items : [{ id: '1', Display: title }]).map((c) => ({
      id: `c${c.id}`, label: htmlToText(c.Display) || `Item ${c.id}`, left, right, min, max,
    }));
    return [{ ...base, type: 'slidergroup', scaleMin: min, scaleMax: max, dimensions }];
  }

  if (type === 'TE') {
    const number = p.Validation?.Settings?.ContentType === 'ValidNumber';
    if (sel === 'FORM') {
      const fields = ordered(p.Choices, p.ChoiceOrder);
      if (!fields.length) return { skip: 'form without fields' };
      return fields.map((c, i) => ({
        ...base,
        name: nextName(`${name}_${c.id}`),
        title: i === 0 ? `${title}\n${htmlToText(c.Display)}` : htmlToText(c.Display),
        type: number ? 'number' : 'text',
      }));
    }
    if (sel === 'ML' || sel === 'ESTB') return [{ ...base, type: 'comment', rows: 4 }];
    return [{ ...base, type: number ? 'number' : 'text' }];
  }

  if (type === 'RO') {
    const choices = choiceItems(p);
    if (choices.length < 2) return { skip: 'rank order with fewer than 2 items' };
    return [{ ...base, type: 'ranking', choices }];
  }

  if (type === 'CS') {
    const choices = choiceItems(p);
    if (!choices.length) return { skip: 'constant sum without items' };
    const total = Number(p.Validation?.Settings?.ChoiceTotal ?? p.Validation?.Settings?.Total ?? p.Configuration?.CSSliderMax);
    return [{ ...base, type: 'pointallocation', budget: Number.isFinite(total) && total > 0 ? total : 100, choices }];
  }

  const unsupported = {
    HeatMap: 'heat map', HotSpot: 'hot spot', Draw: 'drawing', FileUpload: 'file upload', Signature: 'signature',
    SBS: 'side-by-side', Timing: 'timing', Meta: 'meta info', Captcha: 'captcha', PGR: 'pick, group & rank', GAP: 'gap analysis',
    TreeSelect: 'drill down', Highlight: 'highlight', SS: 'graphic slider',
  };
  return { skip: unsupported[type] ? `${unsupported[type]} has no native equivalent` : `question type ${type || '?'} is not supported` };
}

/**
 * Convert a parsed .qsf object. Returns { surveyConfig, report } where report =
 * { version, title, converted, skipped: [{ id, tag, type, reason }], notes: [...] }.
 * Throws when the input is not a Qualtrics survey file.
 */
export function qsfToSurveyConfig(qsf) {
  const elements = Array.isArray(qsf?.SurveyElements) ? qsf.SurveyElements : null;
  if (!qsf?.SurveyEntry || !elements) throw new Error('This is not a Qualtrics survey file (.qsf).');
  const notes = new Set();
  const questions = new Map(elements.filter((e) => e.Element === 'SQ' && e.Payload).map((e) => [e.Payload.QuestionID || e.PrimaryAttribute, e.Payload]));
  const blocks = asList(elements.find((e) => e.Element === 'BL')?.Payload).filter(Boolean);
  const blockById = new Map(blocks.map((b) => [b.ID, b]));
  if (elements.some((e) => e.Element === 'QO')) notes.add('quotas');
  const name = makeNamer();
  const pages = [];
  const skipped = [];
  let converted = 0;
  const seen = new Set();

  const pushPage = (els) => {
    if (els.length) pages.push({ name: `page_${pages.length + 1}`, elements: els });
  };

  const order = flowBlockIds(elements, blocks, notes);
  for (const id of order) {
    const block = blockById.get(id);
    if (!block || block.Type === 'Trash') continue;
    let current = [];
    for (const item of asList(block.BlockElements)) {
      if (item?.Type === 'Page Break') {
        pushPage(current);
        current = [];
        continue;
      }
      if (item?.Type !== 'Question') continue;
      const p = questions.get(item.QuestionID);
      if (!p || seen.has(item.QuestionID)) continue;
      seen.add(item.QuestionID);
      const out = convertQuestion(p, name(p.DataExportTag, p.QuestionID), notes, name);
      if (Array.isArray(out)) {
        current.push(...out);
        if (p.QuestionType !== 'DB') converted += 1;
      } else {
        skipped.push({ id: p.QuestionID, tag: p.DataExportTag || '', type: [p.QuestionType, p.Selector].filter(Boolean).join('/'), reason: out.skip, text: htmlToText(p.QuestionText).slice(0, 120) });
      }
    }
    pushPage(current);
  }

  const title = String(qsf.SurveyEntry.SurveyName || 'Imported Qualtrics survey').trim();
  const surveyConfig = {
    title,
    description: htmlToText(qsf.SurveyEntry.SurveyDescription || ''),
    showQuestionNumbers: 'on',
    showProgressBar: 'top',
    pages: pages.length ? pages : [{ name: 'page_1', elements: [] }],
  };
  return { surveyConfig, report: { version: QSF_IMPORT_VERSION, title, converted, skipped, notes: [...notes].sort() } };
}

export function isQsfFile(name, text) {
  if (/\.qsf$/i.test(String(name || ''))) return true;
  return /"SurveyEntry"\s*:/.test(String(text || '').slice(0, 2000)) && /"SurveyElements"\s*:/.test(String(text || ''));
}

const NOTE_TEXT = {
  branch: ['Branches in the survey flow were flattened; every block is shown.', '调查流程里的分支被展开了，所有区块都会显示。'],
  randomizer: ['Block randomizers were not converted; blocks appear in their listed order.', '区块随机器没有转换，区块按原顺序出现。'],
  embedded_data: ['Embedded data fields were not converted. URL parameters are recorded automatically.', '嵌入数据没有转换。链接参数平台会自动记录。'],
  end_survey: ['"End survey" elements in the flow were ignored.', '流程中的"结束调查"元素被忽略了。'],
  display_logic: ['Display logic was not converted; all questions are shown.', '显示逻辑没有转换，所有题目都会显示。'],
  skip_logic: ['Skip logic was not converted.', '跳转逻辑没有转换。'],
  choice_randomization: ['Choice randomization was not converted.', '选项随机没有转换。'],
  piped_text: ['Piped text like ${q://…} is shown literally; edit those titles.', '管道文本（如 ${q://…}）会原样显示，请修改这些标题。'],
  images_in_text: ['Images inside question text were dropped; add them through the media library.', '题干里的图片没有导入，请通过媒体库添加。'],
  choice_text_entry: ['"Other, please specify" text boxes on choices were dropped.', '选项上的"其他（请注明）"输入框没有导入。'],
  matrix_multiple_answer: ['Multiple-answer matrices became single-answer matrices.', '多选矩阵题变成了单选矩阵题。'],
  quotas: ['Quotas were not converted.', '配额没有转换。'],
};

export function qsfNoteText(note, L) {
  const pair = NOTE_TEXT[note];
  return pair ? L(pair[0], pair[1]) : note;
}
