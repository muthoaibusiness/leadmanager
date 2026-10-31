// Dirty check for FollowUpModal: true when any field differs from the
// defaults the modal opens with (next day at 10:00, nothing typed, no
// customer-requested promise).
export function followupDirty(
  { note = '', newNote = '', customerAsked = false, date = '', time = '' } = {},
  { defDate, defTime = '10:00' } = {},
) {
  return (
    note.trim() !== '' ||
    newNote.trim() !== '' ||
    customerAsked ||
    date !== defDate ||
    time !== defTime
  );
}
