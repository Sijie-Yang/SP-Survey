export const QUESTION_MODE_WRITE_REFUSED = '当前是问答模式，尚未修改。可以切换到调整模式执行这条请求。';

const EXPLAIN = /(?:how (?:to|do i|should)|what(?:'s| is) the difference|explain|区别|怎么(?:发布|设计|做)|如何(?:发布|设计|做)|告诉我如何|只(?:是)?解释|不要实际|先不要|不要真的|不要执行|do not (?:actually )?(?:publish|delete)|don't (?:actually )?(?:publish|delete)|without (?:actually )?(?:publish|deleting))/i;
const NEGATE_WRITE = /(?:不要实际|不要真的|不要执行|先不要|只(?:是)?解释|without (?:actually )?(?:doing|changing|publishing)|do not (?:actually )?(?:do|change|publish|delete)|don't (?:actually )?(?:do|change|publish|delete))/i;
const PROJECT_META = /(?:项目名称|项目名|项目描述|project name|project title|project description|rename the project|改(?:一下)?项目)/i;
const PUBLISH = /(?:\bpublish\b|发布到(?:参与者|主页|线上)?|正式发布)/i;
const DELETE = /(?:delete the (?:project|survey)|remove the project|删除项目|删掉这个项目)/i;
const DRAFT_OBJECT = /(?:问卷|调查|草稿|题目|问题|这道题|这题|当前题|这个标题|标题|主题色|语言|选项|页面|页序|必答|required|title|theme|locale|choice|page|question|survey|questionnaire|draft)/i;
const DRAFT_ACTION = /(?:改成|改为|改一下|设置成|设为|设成|修改|添加|新增|删除|调整|更新|重排|重做|换成|重新生成|加一[页题]|加一道|change|modify|update|revise|reorder|add|remove|set|make|rename|edit|regenerate|rebuild)/i;
const GENERATE = /(?:regenerate|rebuild|redesign|design|create|make|build|generate|draft).{0,48}(?:survey|questionnaire)|(?:重新生成|重新设计|重新制作|设计|创建|生成|制作|编写|构建|做).{0,48}(?:问卷|调查)/i;
const PAGE_COUNT = /(?:现在|当前)?有几[页题]|多少[页题]|page count|how many pages|how many questions/i;
const CONTINUE = /继续刚才|继续该项|继续之前那|切换到调整并执行|continue (?:the )?(?:last|previous|prior) (?:task|change|edit)|switch to adjust and (?:run|execute)/i;
const CURRENT_QUESTION = /(?:这道题|这题|当前题|这个标题|this question|this title|the current question)/i;
const THEME_OR_REQUIRED = /(?:主题色|主色|theme(?:\s*color)?|locale|语言|设为必答|设成必答|改为必答|make (?:it )?required|set (?:it )?required)/i;

function textOf(message) {
  return String(message || '').trim();
}

export function isExplanationOrNegation(message) {
  const text = textOf(message);
  return EXPLAIN.test(text) || NEGATE_WRITE.test(text);
}

export function isPageCountQuestion(message) {
  return PAGE_COUNT.test(textOf(message));
}

export function requestsContinuePriorTask(message) {
  return CONTINUE.test(textOf(message));
}

export function requestsPublishOrDelete(message) {
  const text = textOf(message);
  if (isExplanationOrNegation(text)) return false;
  return PUBLISH.test(text) || DELETE.test(text);
}

export function requestsDraftChange(message) {
  return classifyUserIntent(message).draftWrite;
}

function splitClauses(message) {
  return textOf(message)
    .split(/[。！？?\n]+|(?:(?<=\S)(?:然后|并且|同时|另外))|(?:;|；)/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyClause(clause) {
  if (!clause) return null;
  if (CONTINUE.test(clause)) return 'draft_edit';
  if (isExplanationOrNegation(clause)) return 'answer';
  if (DELETE.test(clause)) return 'delete';
  if (PUBLISH.test(clause)) return 'publish';
  if (PROJECT_META.test(clause) && DRAFT_ACTION.test(clause)) return 'project_meta';
  if (GENERATE.test(clause)) return 'draft_edit';
  if (/(?:加一[页题]|加一道|知情同意|add (?:a )?(?:page|question))/i.test(clause)) {
    return 'draft_edit';
  }
  if (THEME_OR_REQUIRED.test(clause) && (DRAFT_ACTION.test(clause) || CURRENT_QUESTION.test(clause))) {
    return 'draft_edit';
  }
  if (CURRENT_QUESTION.test(clause) && DRAFT_ACTION.test(clause)) return 'draft_edit';
  if (DRAFT_ACTION.test(clause) && DRAFT_OBJECT.test(clause)) return 'draft_edit';
  if (PAGE_COUNT.test(clause)) return 'answer';
  return 'answer';
}

export function classifyUserIntent(message, assistantMode = 'agent') {
  const text = textOf(message);
  const continuePrior = requestsContinuePriorTask(text);
  const clauses = splitClauses(text);
  const parts = (clauses.length ? clauses : [text]).map(classifyClause).filter(Boolean);
  const unique = [...new Set(parts)];
  const explanation = isExplanationOrNegation(text);
  const pageCount = isPageCountQuestion(text);
  let goals = unique;
  if (continuePrior && !goals.includes('draft_edit')) goals = ['draft_edit', ...goals];
  if (explanation) {
    goals = goals.map((goal) => (goal === 'publish' || goal === 'delete' || goal === 'draft_edit'
      ? 'answer'
      : goal));
  }
  if (!goals.length) goals = ['answer'];
  const mixed = goals.length > 1;
  const primary = goals.find((goal) => goal !== 'answer') || goals[0];
  const draftWrite = goals.includes('draft_edit');
  const publishOrDelete = goals.includes('publish') || goals.includes('delete');
  const projectMeta = goals.includes('project_meta');
  const write = draftWrite || publishOrDelete || projectMeta;
  return {
    goal: mixed ? 'mixed' : primary,
    goals,
    mixed,
    write,
    draftWrite,
    projectMeta,
    publishOrDelete,
    publish: goals.includes('publish'),
    delete: goals.includes('delete'),
    continuePrior,
    pageCount,
    explanation,
    readOnly: assistantMode === 'question'
      ? !continuePrior
      : (!write || (pageCount && !draftWrite && !publishOrDelete && !projectMeta)),
  };
}

export function shouldPrepareWrite({ assistantMode, message } = {}) {
  const intent = classifyUserIntent(message, assistantMode);
  return intent.draftWrite && assistantMode !== 'question' && ['generate', 'adjust', 'agent'].includes(assistantMode);
}

export function initialLoadingStatus(assistantMode, intent = classifyUserIntent('', assistantMode)) {
  if (assistantMode === 'question' || intent.readOnly || (!intent.draftWrite && !intent.projectMeta && !intent.publishOrDelete && !intent.write)) {
    return 'Looking up the current settings…';
  }
  if (assistantMode === 'adjust') return 'Preparing the edit…';
  if (assistantMode === 'generate') return 'Designing the survey…';
  return 'Working on your request…';
}

export function summarizeWorkingCopy(focus = {}) {
  const copy = focus.workingCopy && typeof focus.workingCopy === 'object' ? focus.workingCopy : null;
  const page = focus.pageWorkingCopy && typeof focus.pageWorkingCopy === 'object' ? focus.pageWorkingCopy : null;
  if (!(focus.dirty || focus.pageDirty || focus.hasUnsavedChanges) || (!copy && !page)) return '';
  const fields = ['name', 'title', 'type', 'isRequired', 'description']
    .map((key) => (copy?.[key] != null && copy[key] !== '' ? `question.${key}=${String(copy[key]).slice(0, 120)}` : ''))
    .filter(Boolean);
  const complex = ['dimensions', 'choices', 'rows', 'columns', 'scaleMin', 'scaleMax', 'scaleStep', 'rateMin', 'rateMax', 'imageCount', 'imageSelectionMode', 'mediaAssignmentMode', 'mediaFolders', 'trialCount', 'budget'];
  complex.forEach((key) => {
    if (copy?.[key] == null) return;
    const raw = typeof copy[key] === 'object' ? JSON.stringify(copy[key]) : String(copy[key]);
    if (raw && raw !== '[]' && raw !== '{}') fields.push(`question.${key}=${raw.slice(0, 400)}`);
    else fields.push(`question.${key}=${raw}`);
  });
  if (page?.title) fields.push(`page.title=${String(page.title).slice(0, 120)}`);
  if (page?.description) fields.push(`page.description=${String(page.description).slice(0, 120)}`);
  if (page?.name) fields.push(`page.name=${String(page.name).slice(0, 80)}`);
  if (!fields.length) return '';
  return `\nUnsaved editor working copy (NOT saved; do not persist unless the user explicitly asks to save):\n- ${fields.join('\n- ')}`;
}
