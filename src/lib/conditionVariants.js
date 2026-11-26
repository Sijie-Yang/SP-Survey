// Kept free of survey-core so analysis modules also load in the Worker's Node ESM tests.

/** Valid per-condition variants of a question (empty titles fall back to the question title). */
export function conditionVariants(question) {
  const list = Array.isArray(question?.conditionVariants) ? question.conditionVariants : [];
  return list.filter((v) => v && typeof v.condition === 'string' && v.condition.trim());
}

/** Condition ids whose answers to this question are reverse-coded in analysis. */
export function reverseCodedConditions(question) {
  return conditionVariants(question).filter((v) => v.reverseCoded === true).map((v) => v.condition);
}
