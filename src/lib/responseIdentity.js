/** Submission identity: participants may contribute multiple sessions/rounds. */
export function responseRecordKey(row) {
  if (row?.id != null) return String(row.id);
  if (row?._filename) return String(row._filename);
  return JSON.stringify([row?.participant_id || 'unknown',
    row?.created_at || row?.survey_metadata?.completion_time || row?.saved_at || '',
    row?.survey_metadata?.session_id || '', row?.survey_metadata?.attempt_index ?? '']);
}

/** Date inputs represent local calendar days, with an exclusive next-day end. */
export function responseWithinDateRange(row, from, to) {
  if (!from && !to) return true;
  const raw = row.created_at || row.survey_metadata?.completion_time || row.saved_at;
  const timestamp = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return false;
  const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  let end = Infinity;
  if (to) {
    const nextDay = new Date(`${to}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    end = nextDay.getTime();
  }
  return timestamp >= start && timestamp < end;
}
