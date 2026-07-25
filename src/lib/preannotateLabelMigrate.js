/**
 * Project-wide label rename / clear / delete across preannotation JSON files.
 */
import {
  loadPreannotation,
  savePreannotation,
  DEFAULT_SAM_LABELS,
} from './imageFeaturesR2';
import { normalizeMediaEntry } from './mediaUtils';
import {
  remapShapeLabels,
  clearShapeLabel,
  removeShapesWithLabel,
} from './preannotateLabels';

/**
 * @param {'rename'|'clear'|'delete_shapes'} action
 */
export async function migrateLabelAcrossMediaList(r2Prefix, mediaList, {
  action,
  oldName,
  newName = '',
  labelNames = DEFAULT_SAM_LABELS,
  onProgress,
  shouldAbort,
} = {}) {
  const name = String(oldName || '').trim();
  if (!name) throw new Error('Missing label name.');
  if (action === 'rename' && !String(newName || '').trim()) {
    throw new Error('Missing new label name.');
  }
  const list = (mediaList || []).map((m) => normalizeMediaEntry(m)).filter((m) => m?.url || m?.name);
  const summary = { total: list.length, done: 0, changed: 0, failed: 0, failures: [] };

  for (let i = 0; i < list.length; i += 1) {
    if (shouldAbort?.()) {
      summary.aborted = true;
      break;
    }
    const entry = list[i];
    try {
      const doc = await loadPreannotation(r2Prefix, entry);
      const shapes = Array.isArray(doc?.shapes) ? doc.shapes : [];
      let next = shapes;
      if (action === 'rename') {
        next = remapShapeLabels(shapes, name, String(newName).trim());
      } else if (action === 'clear') {
        next = clearShapeLabel(shapes, name);
      } else if (action === 'delete_shapes') {
        next = removeShapesWithLabel(shapes, name);
      }
      const changed = JSON.stringify(next) !== JSON.stringify(shapes);
      if (changed) {
        await savePreannotation(r2Prefix, entry, {
          image: entry.url || doc?.image,
          shapes: next,
          labels: labelNames,
          review_status: doc?.review_status || null,
        });
        summary.changed += 1;
      }
      summary.done += 1;
      onProgress?.({ done: summary.done, total: summary.total, name: entry.name, changed });
    } catch (err) {
      summary.failed += 1;
      summary.done += 1;
      summary.failures.push({ name: entry.name, error: err.message || String(err) });
      onProgress?.({ done: summary.done, total: summary.total, name: entry.name, error: err.message });
    }
  }
  return summary;
}
