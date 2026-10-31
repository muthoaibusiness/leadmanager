// Map the app's legacy toast types ('ok' | 'warn' | 'err' | '') to the
// goey-toast method name used by useProjectToast. ProjectsToaster is the
// source of truth for notifications (top-center, goey styling).
export function toastFor(type) {
  if (type === 'ok') return 'success';
  if (type === 'warn') return 'warning';
  if (type === 'err') return 'error';
  return 'info';
}

// Dispatch `msg` on a useProjectToast() handle using the legacy type.
export function toastMsg(toast, msg, type = '') {
  toast[toastFor(type)](msg);
}
