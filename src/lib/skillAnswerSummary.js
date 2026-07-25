/**
 * Human-readable summaries for skill answers (preview-before-complete + results).
 * Pass locale 'en' | 'zh' (default 'en').
 */

import { stripSkillAnswerContext } from './skillMediaUtils';

const MODE_LABELS = {
  en: {
    attention_map: 'Attention map',
    route_trace: 'Route trace',
    budget_lab: 'Budget allocation',
    flash_reveal: 'Flash reveal',
    cue_detective: 'Cue ranking',
  },
  zh: {
    attention_map: '感知点标记',
    route_trace: '路线描绘',
    budget_lab: '微改造预算',
    flash_reveal: '渐显识别',
    cue_detective: '线索排序',
  },
};

const COPY = {
  en: {
    noAnswer: '(no answer)',
    task: (m) => `Task: ${m}`,
    marks: (n) => `${n} marked location${n === 1 ? '' : 's'}`,
    categories: (s) => `Categories: ${s}`,
    pathPoints: (n) => `Route path: ${n} sample point${n === 1 ? '' : 's'}`,
    pathLength: (v) => `Path length ${v}`,
    directness: (v) => `Directness ${v}`,
    budget: (s) => `Budget: ${s}`,
    budgetNone: 'Budget: none allocated',
    total: (v) => `Total ${v} / 100`,
    priority: (v) => `Top item: ${v}`,
    recognitionMs: (v) => `Recognition time ${v} ms`,
    revealRatio: (v) => `Reveal ~${v}%`,
    sceneType: (v) => `Scene type: ${v}`,
    rankedCues: (s) => `Cue order: ${s}`,
    ratings: (s) => `Ratings: ${s}`,
    words: (s) => `Words: ${s}`,
    choice: (v) => `Choice: ${v}`,
    text: (v) => `Text: ${v}`,
    preference: (v) => `Preference: ${v}`,
    elapsed: (v) => `Duration ${v} s`,
    items: (k, n) => `${k}: ${n} item${n === 1 ? '' : 's'}`,
    answered: '(answered — see raw data)',
  },
  zh: {
    noAnswer: '（未作答）',
    task: (m) => `任务：${m}`,
    marks: (n) => `标记 ${n} 个位置`,
    categories: (s) => `分类：${s}`,
    pathPoints: (n) => `路线轨迹 ${n} 个采样点`,
    pathLength: (v) => `路径长度 ${v}`,
    directness: (v) => `直达度 ${v}`,
    budget: (s) => `预算：${s}`,
    budgetNone: '预算：未分配',
    total: (v) => `合计 ${v} / 100`,
    priority: (v) => `最高项：${v}`,
    recognitionMs: (v) => `识别用时 ${v} ms`,
    revealRatio: (v) => `画面清晰约 ${v}%`,
    sceneType: (v) => `场景判断：${v}`,
    rankedCues: (s) => `线索顺序：${s}`,
    ratings: (s) => `评分：${s}`,
    words: (s) => `词条：${s}`,
    choice: (v) => `选择：${v}`,
    text: (v) => `文字：${v}`,
    preference: (v) => `偏好值：${v}`,
    elapsed: (v) => `用时 ${v} 秒`,
    items: (k, n) => `${k}：${n} 项`,
    answered: '（已作答，详见原始数据）',
  },
};

function resolveLocale(locale) {
  return locale === 'zh' ? 'zh' : 'en';
}

function fmtNum(n, digits = 2) {
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}

/**
 * @param {unknown} answer
 * @param {'en'|'zh'} [locale='en']
 * @returns {string[]}
 */
export function summarizeSkillAnswer(answer, locale = 'en') {
  const lang = resolveLocale(locale);
  const c = COPY[lang];
  const modeLabels = MODE_LABELS[lang];

  if (answer == null || answer === '') return [c.noAnswer];
  if (typeof answer !== 'object') return [String(answer)];

  const lines = [];
  const mode = answer.mode != null ? String(answer.mode) : '';
  if (mode) lines.push(c.task(modeLabels[mode] || mode));

  if (Array.isArray(answer.points)) {
    lines.push(c.marks(answer.points.length));
    if (answer.counts && typeof answer.counts === 'object') {
      const parts = Object.entries(answer.counts).map(([k, v]) => `${k}×${v}`);
      if (parts.length) lines.push(c.categories(parts.join(lang === 'zh' ? '，' : ', ')));
    }
  }

  if (Array.isArray(answer.path)) {
    lines.push(c.pathPoints(answer.path.length));
    if (answer.pathLength != null) lines.push(c.pathLength(fmtNum(answer.pathLength)));
    if (answer.directness != null) lines.push(c.directness(fmtNum(answer.directness)));
  }

  if (answer.allocations && typeof answer.allocations === 'object') {
    const parts = Object.entries(answer.allocations)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${k} ${v}`);
    lines.push(parts.length ? c.budget(parts.join(lang === 'zh' ? '，' : ', ')) : c.budgetNone);
    if (answer.total != null) lines.push(c.total(answer.total));
    if (answer.priority) lines.push(c.priority(answer.priority));
  }

  if (answer.recognitionMs != null || answer.sceneType != null) {
    if (answer.recognitionMs != null) {
      lines.push(c.recognitionMs(Math.round(Number(answer.recognitionMs))));
    }
    if (answer.revealRatio != null) {
      lines.push(c.revealRatio(Math.round(Number(answer.revealRatio) * 100)));
    }
    if (answer.sceneType) lines.push(c.sceneType(answer.sceneType));
  }

  if (Array.isArray(answer.rankedCues) && answer.rankedCues.length) {
    lines.push(c.rankedCues(answer.rankedCues.join(' → ')));
  }

  if (Array.isArray(answer.ratings) && answer.ratings.length) {
    const parts = answer.ratings.map((d) => {
      const label = d.label || d.id || `${d.left || ''}/${d.right || ''}`;
      return `${label}=${d.value}`;
    });
    lines.push(c.ratings(parts.join(lang === 'zh' ? '，' : ', ')));
  }

  if (Array.isArray(answer.words) && answer.words.length) {
    lines.push(c.words(answer.words.join(lang === 'zh' ? '，' : ', ')));
  }
  if (answer.choice != null && answer.choice !== '') {
    lines.push(c.choice(answer.choice));
  }
  if (typeof answer.text === 'string' && answer.text.trim()) {
    lines.push(c.text(answer.text.trim()));
  }

  if (answer.preference != null) lines.push(c.preference(answer.preference));
  if (answer.elapsedMs != null) {
    lines.push(c.elapsed(Math.round(Number(answer.elapsedMs) / 1000)));
  }

  if (lines.length <= (mode ? 1 : 0)) {
    const clean = stripSkillAnswerContext(answer);
    const skip = new Set(['mode', 'points', 'path', 'allocations', 'counts', 'weights', 'ratings', 'words']);
    Object.entries(clean || {}).forEach(([k, v]) => {
      if (skip.has(k)) return;
      if (v == null) return;
      if (Array.isArray(v)) {
        lines.push(c.items(k, v.length));
        return;
      }
      if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v)}`);
        return;
      }
      lines.push(`${k}: ${v}`);
    });
  }

  if (!lines.length) lines.push(c.answered);
  return lines;
}

/** Single-line summary for tables / SurveyJS displayValue. */
export function summarizeSkillAnswerOneLine(answer, locale = 'en') {
  return summarizeSkillAnswer(answer, locale).join(locale === 'zh' ? ' · ' : ' · ');
}
