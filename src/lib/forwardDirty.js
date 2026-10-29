// Dirty check for ForwardModal: true when any destination/offer/meeting field
// differs from the state the modal opens with. Navigation between steps
// (Back/Next) never counts as dirty — only closing does.
export function forwardDirty({
  selected = null,
  pq = '',
  meetingAt = '',
  meetingLink = '',
  shared = [],
  meetingType = 'ONLINE',
  projectId = '',
  ourOffer = '',
  clientOffer = '',
  totalSft = '',
  offerNotes = '',
} = {}) {
  return (
    !!selected ||
    pq.trim() !== '' ||
    meetingAt !== '' ||
    meetingLink.trim() !== '' ||
    shared.length > 0 ||
    meetingType !== 'ONLINE' ||
    projectId !== '' ||
    ourOffer !== '' ||
    clientOffer !== '' ||
    totalSft !== '' ||
    offerNotes.trim() !== ''
  );
}
