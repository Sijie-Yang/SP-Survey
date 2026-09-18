/** Small, valid starting points. IDs/revisions of saved interactions are unchanged. */
export const SKILL_STARTERS = [
  { id: 'rating', en: 'Rating (1–5)', zh: '评分（1–5）', field: { key: 'value', type: 'rating', min: 1, max: 5 }, value: 3,
    body: '<label>Rating / 评分 <input id="value" type="range" min="1" max="5" value="3" oninput="document.getElementById(\'score\').textContent=this.value"></label><output id="score">3</output>', expression: 'Number(document.getElementById("value").value)' },
  { id: 'number', en: 'Number', zh: '数值', field: { key: 'value', type: 'number', min: 0 }, value: 0,
    body: '<label>Value / 数值 <input id="value" type="number" min="0" value="0"></label>', expression: 'Number(document.getElementById("value").value)' },
  { id: 'choice', en: 'Single choice', zh: '单选', field: { key: 'value', type: 'choice', options: ['A', 'B'] }, value: 'A',
    body: '<label>Choice / 选择 <select id="value"><option>A</option><option>B</option></select></label>', expression: 'document.getElementById("value").value' },
];

export function createSkillStarter(id = 'rating') {
  const starter = SKILL_STARTERS.find((s) => s.id === id) || SKILL_STARTERS[0];
  return {
    resultSchema: [{ ...starter.field, label: 'Answer' }], exampleAnswer: { value: starter.value },
    configSchema: ['min', 'max'].filter((key) => starter.field[key] != null).map((key) => ({ key, label: key, type: 'number' })),
    defaultConfig: { mediaCount: 0, ...(starter.field.min != null ? { min: starter.field.min } : {}), ...(starter.field.max != null ? { max: starter.field.max } : {}) },
    sourceHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui;padding:16px;margin:0}input,select,button{font:inherit;min-height:44px;max-width:100%;box-sizing:border-box}button{display:block;margin-top:16px;padding:8px 20px}input[type=range]{width:100%}
</style></head><body>${starter.body}
<button onclick='SPSkill.setAnswer({value:${starter.expression}})'>Confirm / 确认</button>
<script>document.addEventListener('spskill-init',function(){var el=document.getElementById('value');var cfg=SPSkill.getConfig();if(cfg.min!=null)el.min=cfg.min;if(cfg.max!=null)el.max=cfg.max;var v=SPSkill.getValue();if(v&&v.value!=null)el.value=v.value;var score=document.getElementById('score');if(score)score.textContent=el.value;SPSkill.ready();});</script>
</body></html>`,
  };
}
