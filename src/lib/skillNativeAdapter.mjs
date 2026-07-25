/**
 * Convert declared Skill fields to equivalent native questions and answer units.
 * This module is deliberately UI/export agnostic and is shared by browser and Worker code.
 */

function mediaKey(value) {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : value.url || value.name || '';
  const clean = String(raw).split('?')[0];
  return clean.split('/').pop() || clean;
}

function rootMedia(root, shown = []) {
  const direct = root?.imageUrl || root?.image_url || root?.videoUrl || root?.video_url || root?.mediaUrl;
  const urls = Array.isArray(root?.shownUrls) && root.shownUrls.length
    ? root.shownUrls
    : (Array.isArray(shown) ? shown : []);
  return { direct, urls };
}

function hasMediaContract(question, field) {
  if (field?.media === true || field?.imageUrl || field?.videoUrl) return true;
  if (['mediaChoice', 'mediaRankedList', 'mediaMatrix', 'points', 'path', 'polygon', 'bbox', 'box', 'timeRanges', 'timeSeries', 'pairwiseChoice', 'pairwisePreference', 'bestWorst', 'compositeBlocks'].includes(field?.type)) return true;
  const cfg = question?.skillConfig || {};
  return Boolean(
    question?.randomImageSelection
    || Number(question?.imageCount) > 0
    || Number(cfg.mediaCount) > 0
    || cfg.mediaType,
  );
}

function optionObjects(options = []) {
  return (options || []).map((option) => (
    option && typeof option === 'object'
      ? option
      : { value: option, text: String(option) }
  ));
}

export function skillFieldNativeQuestion(question, field) {
  const config = question?.skillConfig || {};
  // Standard native settings may be researcher-editable through configSchema.
  // Apply them before constructing the equivalent native question so Builder,
  // Results Analysis, and export all see the same effective contract.
  const configSettings = {};
  ['options', 'rows', 'columns', 'dimensions', 'budget', 'labels', 'min', 'max'].forEach((key) => {
    if (config[key] !== undefined && config[key] !== null) configSettings[key] = config[key];
  });
  if (config.choices != null && configSettings.options == null) configSettings.options = config.choices;
  if (config.rateMin != null && configSettings.min == null) configSettings.min = config.rateMin;
  if (config.rateMax != null && configSettings.max == null) configSettings.max = config.rateMax;
  if (config.scaleMin != null && configSettings.min == null) configSettings.min = config.scaleMin;
  if (config.scaleMax != null && configSettings.max == null) configSettings.max = config.scaleMax;
  field = { ...field, ...configSettings };
  const media = hasMediaContract(question, field);
  const name = `${question.name}__${field.key}`;
  const base = {
    name,
    title: field.label || field.key,
    _skillSourceQuestion: question.name,
    _skillFieldKey: field.key,
    _skillFieldType: field.type,
  };
  switch (field.type) {
    case 'number':
      return media
        ? { ...base, type: 'mediarating', rateMin: field.min ?? 1, rateMax: field.max ?? 5 }
        : { ...base, type: 'number', min: field.min, max: field.max };
    case 'rating':
      return media
        ? { ...base, type: 'mediarating', rateMin: field.min ?? 1, rateMax: field.max ?? 5 }
        : { ...base, type: 'rating', rateMin: field.min ?? 1, rateMax: field.max ?? 5 };
    case 'count': return { ...base, type: 'number', min: field.min ?? 0, max: field.max };
    case 'boolean': return { ...base, type: media ? 'mediaboolean' : 'boolean' };
    case 'choice': return { ...base, type: 'radiogroup', choices: optionObjects(field.options) };
    case 'color': return { ...base, type: 'skillquestion', skillId: 'preset_emotion_color_picker' };
    case 'text':
    case 'string': return { ...base, type: 'comment' };
    case 'multiChoice': return {
      ...base,
      type: media ? 'imagecheckbox' : 'checkbox',
      choices: optionObjects(field.options),
    };
    case 'matrix': return { ...base, type: media ? 'mediamatrix' : 'matrix', rows: field.rows || [], columns: field.columns || field.options || [] };
    case 'mediaMatrix': return { ...base, type: 'mediamatrix', rows: field.rows || [], columns: field.columns || field.options || [] };
    case 'rankedList': return { ...base, type: 'ranking', choices: optionObjects(field.options) };
    case 'allocation': return { ...base, type: media ? 'mediapointallocation' : 'pointallocation', choices: optionObjects(field.options), budget: field.budget || 100 };
    case 'scaleGroup': return { ...base, type: media ? 'mediaslidergroup' : 'slidergroup', dimensions: field.dimensions || field.options || [] };
    case 'mediaChoice': return { ...base, type: 'mediapicker' };
    case 'mediaRankedList': return { ...base, type: 'mediaranking' };
    case 'points':
    case 'path':
    case 'polygon':
    case 'bbox':
    case 'box': return { ...base, type: 'imageannotation', annotationLabels: field.labels || [] };
    case 'pairwiseChoice': return { ...base, type: 'skillquestion', skillId: 'preset_image_preference_forced' };
    case 'pairwisePreference':
    case 'pairwise': return { ...base, type: 'skillquestion', skillId: 'preset_image_preference_slider' };
    case 'bestWorst': return { ...base, type: 'skillquestion', skillId: 'preset_best_worst_choice' };
    case 'compositeBlocks': return { ...base, type: 'skillquestion', skillId: 'preset_composite_blocks' };
    case 'timeRanges': return { ...base, type: 'skillquestion', skillId: 'preset_video_moment_tag' };
    case 'timeSeries': return { ...base, type: 'skillquestion', skillId: 'preset_video_continuous_rating' };
    default: return null;
  }
}

function spatialAnswer(type, value, label) {
  const arrays = Array.isArray(value) && value.some((item) => Array.isArray(item) || Array.isArray(item?.points))
    ? value
    : [value];
  const shapes = arrays.flatMap((item) => {
    const points = (Array.isArray(item) ? item : item?.points || [])
      .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    if (!points.length) return [];
    if (type === 'points') return points.map((point) => ({ tool: 'point', points: [point], label: item?.label || point.label || label }));
    const tool = type === 'path' ? 'line' : type;
    return [{ tool, points: type === 'bbox' ? points.slice(0, 2) : points, label: item?.label || label }];
  });
  return { shapes };
}

export function adaptSkillFieldValue(question, field, rootAnswer, shownImages = []) {
  const root = rootAnswer && typeof rootAnswer === 'object' && !Array.isArray(rootAnswer)
    ? rootAnswer : { value: rootAnswer };
  const value = root[field.key];
  const { direct, urls } = rootMedia(root, shownImages);
  const shown = urls.length ? urls : (direct ? [direct] : shownImages || []);
  if (value == null) return null;

  if (field.type === 'count') {
    const count = Array.isArray(value) ? value.length : Number(value);
    return Number.isFinite(count) ? { answer: count, shownImages: shown } : null;
  }
  if (field.type === 'color') {
    const color = typeof value === 'string' ? { hex: value, source: 'custom' } : value;
    return { answer: { ...root, color, imageUrl: root.imageUrl || direct }, shownImages: shown };
  }
  if (field.type === 'compositeBlocks') {
    const block = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return { answer: { ...root, ...block, imageUrl: block.imageUrl || root.imageUrl || direct }, shownImages: shown };
  }

  if (['points', 'path', 'polygon', 'bbox', 'box'].includes(field.type)) {
    return { answer: spatialAnswer(field.type === 'box' ? 'bbox' : field.type, value, field.label || field.key), shownImages: shown };
  }
  if (field.type === 'pairwiseChoice') {
    const pair = value.shownUrls || [value.left ?? value.imageA, value.right ?? value.imageB].filter(Boolean);
    let chosenIndex = value.chosenIndex;
    const winner = value.winner ?? value.choice;
    if (chosenIndex == null && (winner === 'A' || winner === 'B')) chosenIndex = winner === 'A' ? 0 : 1;
    if (chosenIndex == null) {
      const found = pair.map(mediaKey).findIndex((key) => key === mediaKey(winner));
      if (found >= 0) chosenIndex = found;
    }
    const choice = chosenIndex === 0 ? 'A' : (chosenIndex === 1 ? 'B' : value.choice);
    return { answer: { ...value, shownUrls: pair, chosenIndex, choice }, shownImages: pair };
  }
  if (field.type === 'bestWorst') {
    const options = value.shownUrls || value.options || shown;
    const resolveIndex = (pick, index) => {
      if (Number.isInteger(index) && index >= 0 && index < options.length) return index;
      const found = options.map(mediaKey).findIndex((key) => key === mediaKey(pick));
      return found >= 0 ? found : undefined;
    };
    return {
      answer: {
        ...value,
        shownUrls: options,
        bestIndex: resolveIndex(value.best ?? value.bestUrl, value.bestIndex),
        worstIndex: resolveIndex(value.worst ?? value.worstUrl, value.worstIndex),
        bestUrl: value.bestUrl ?? value.best,
        worstUrl: value.worstUrl ?? value.worst,
      },
      shownImages: options,
    };
  }
  if (field.type === 'timeRanges') {
    const segments = Array.isArray(value) ? value : value.segments || value.ranges || [];
    return { answer: { ...root, ...(Array.isArray(value) ? {} : value), segments, videoUrl: value.videoUrl || root.videoUrl || direct }, shownImages: shown };
  }
  if (field.type === 'timeSeries') {
    const samples = Array.isArray(value) ? value : value.samples || value.series || [];
    return { answer: { ...root, ...(Array.isArray(value) ? {} : value), samples, videoUrl: value.videoUrl || root.videoUrl || direct }, shownImages: shown };
  }
  if (field.type === 'pairwise' || field.type === 'pairwisePreference') {
    const answer = typeof value === 'number' ? { ...root, preference: value } : { ...root, ...value };
    return { answer, shownImages: shown };
  }
  return { answer: value, shownImages: shown };
}

export function adaptSkillAnswerEntries(question, field, entries) {
  return (entries || []).map((entry) => {
    const adapted = adaptSkillFieldValue(question, field, entry.answer, entry.shown_images || []);
    return adapted ? { ...entry, answer: adapted.answer, shown_images: adapted.shownImages } : null;
  }).filter(Boolean);
}

function storedUnits(row, questionName) {
  const data = row?.responses?.[questionName];
  if (data == null || data === '') return [];
  if (data && typeof data === 'object' && Array.isArray(data.trials)) {
    return data.trials.map((trial, index) => ({
      answer: trial?.answer ?? trial?.value,
      shownImages: trial?.shown_images || trial?.shownImages || trial?.shown_media || [],
      trialIndex: trial?.trial_index ?? index,
    }));
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'answer' in data) {
    return [{ answer: data.answer, shownImages: data.shown_images || data.shownImages || data.shown_media || [], trialIndex: 0 }];
  }
  return [{ answer: data, shownImages: row?.displayed_images?.[questionName] || [], trialIndex: 0 }];
}

export function adaptResponsesForSkillField(question, field, responses) {
  const nativeQuestion = skillFieldNativeQuestion(question, field);
  if (!nativeQuestion) return { question: null, responses: [] };
  const rows = [];
  (responses || []).forEach((row) => {
    const trials = storedUnits(row, question.name).map((unit) => {
      const adapted = adaptSkillFieldValue(question, field, unit.answer, unit.shownImages);
      return adapted ? { answer: adapted.answer, shown_images: adapted.shownImages, trial_index: unit.trialIndex } : null;
    }).filter(Boolean);
    if (!trials.length) return;
    const responseValue = trials.length === 1
      ? { answer: trials[0].answer, shown_images: trials[0].shown_images }
      : { trials };
    rows.push({
      ...row,
      responses: { ...(row.responses || {}), [nativeQuestion.name]: responseValue },
      displayed_images: { ...(row.displayed_images || {}), [nativeQuestion.name]: trials[0].shown_images },
    });
  });
  return { question: nativeQuestion, responses: rows };
}
