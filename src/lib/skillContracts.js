import { getSkillById } from './skillManager';
import { getPresetSkill } from './presetSkills';

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

/** Freeze every Skill question to an immutable revision and contract snapshot. */
export async function hydrateSkillContractSnapshots(surveyConfig) {
  const config = clone(surveyConfig);
  const questions = (config.pages || []).flatMap((page) => page.elements || [])
    .filter((question) => question?.type === 'skillquestion' && question.skillId);

  for (const question of questions) {
    // Runtime HTML is resolved from the immutable version; never persist it in a draft.
    delete question.skillHtml;
    const presetId = String(question.skillId).replace(/^preset_/, '');
    const skill = String(question.skillId).startsWith('preset_')
      ? getPresetSkill(presetId)
      : await getSkillById(question.skillId, question.skillRevision || null);
    if (!skill) {
      if (Number(question.skillRevision) > 0 && Array.isArray(question.skillResultSchema)) continue;
      throw new Error(`Skill is not accessible: ${question.skillId}`);
    }
    question.skillRevision = Number(
      skill.revision || skill.currentRevision || question.skillRevision || 1,
    );
    question.skillContractVersion = Number(skill.contractVersion || 1);
    question.skillResultSchema = Array.isArray(skill.resultSchema) ? skill.resultSchema : [];
  }
  return config;
}
