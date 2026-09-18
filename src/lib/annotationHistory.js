/** Bounded immutable snapshots; a pointer drag is one edit, not hundreds of edits. */
export function createAnnotationHistory(limit = 40) {
  const past = [], future = [];
  let lastGroup = null;
  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    record(previous, group = null) {
      if (!group || group !== lastGroup) {
        past.push(previous);
        if (past.length > limit) past.shift();
      }
      lastGroup = group; future.length = 0;
    },
    undo(current) { if (!past.length) return current; future.push(current); lastGroup = null; return past.pop(); },
    redo(current) { if (!future.length) return current; past.push(current); lastGroup = null; return future.pop(); },
    reset() { past.length = 0; future.length = 0; lastGroup = null; },
  };
}
