// Dirty check for FollowUpModal: true when any field differs from what the
// modal opened with. The date/time defaults are passed in (next day at 10:00, or
// the pending follow-up's time); the detail fields (type, reminder, purpose,
// project, note choice, outcome) compare against `def` when given, so a caller
// that only knows the original five fields keeps working.
const DETAIL = ['type', 'remindMin', 'purpose', 'purposeOther', 'projectId', 'noteCode', 'outcome'];

export function followupDirty(
  { note = '', newNote = '', customerAsked = false, date = '', time = '', ...rest } = {},
  { defDate, defTime = '10:00', ...def } = {},
) {
  return (
    note.trim() !== String(def.note ?? '').trim() ||
    newNote.trim() !== '' ||
    customerAsked ||
    date !== defDate ||
    time !== defTime ||
    DETAIL.some((k) => k in rest && k in def && String(rest[k] ?? '').trim() !== String(def[k] ?? '').trim())
  );
}
