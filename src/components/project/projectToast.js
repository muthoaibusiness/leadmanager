import { createElement as h } from 'react';
import { gooeyToast } from 'goey-toast';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';

// goey-toast for the Projects tab only. The project console can also be opened
// from Hold Requests; there (and in every other tab) the app's existing toast
// and confirm stay exactly as they were. Each call names the message the old
// toast showed (`legacy`, or nothing where there was none), so outside this tab
// behaviour does not change. The toaster itself is ProjectsToaster.jsx.

const ICON = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
const LEGACY_TYPE = { success: 'ok', error: 'err', warning: 'warn', info: '' };
// A confirmation stays up until it is answered. goey times the expanded state
// with setTimeout, where Infinity would fire at once, hence a finite 10 minutes.
const CONFIRM_MS = 10 * 60 * 1000;

const icon = (type) => h(Mi, { className: 'wp-gt-ico' }, ICON[type]);

// One notification at a time, like the app's own toast: a new one replaces the
// last instead of queueing behind it (goey shows three, then queues).
let lastNote = null;

export function useProjectToast() {
  const { view, showToast } = useApp();
  const on = view === 'properties';

  const notify = (type, title, description, legacy) => {
    if (!on) {
      if (legacy) showToast(legacy, LEGACY_TYPE[type]);
      return null;
    }
    if (lastNote != null) gooeyToast.dismiss(lastNote);
    lastNote = gooeyToast[type](title, {
      description: description && h('span', { className: 'wp-gt-desc' }, description),
      icon: icon(type),
      classNames: { wrapper: 'wp-gt' },
      showTimestamp: false,
      timing: type === 'error' ? { displayDuration: 6000 } : undefined,
      onDismiss: (id) => { if (lastNote === id) lastNote = null; },
    });
    return lastNote;
  };

  // Destructive confirmation: the question is the title, its context the line
  // below, then Cancel and the destructive action side by side. Both buttons
  // live in the description (goey has one action button, placed on a row of
  // its own). Cancel takes focus so the question is keyboard-reachable.
  // onConfirm may return false to keep the toast up. onDismiss(id) fires
  // however the toast goes away.
  const confirm = ({ title, description, confirmLabel, onConfirm, onCancel, onDismiss }) => {
    if (lastNote != null) gooeyToast.dismiss(lastNote); // the question stands alone
    let id = null;
    const cancel = () => { gooeyToast.dismiss(id); onCancel?.(); };
    const accept = () => { if (onConfirm() !== false) gooeyToast.dismiss(id); };
    const body = h('div', null,
      description && h('p', { className: 'wp-gt-confirm-msg' }, description),
      h('div', { className: 'wp-gt-confirm-acts' },
        h('button', { type: 'button', className: 'wp-gt-btn wp-gt-cancel', onClick: cancel, ref: el => { el?.focus({ preventScroll: true }); } }, 'Cancel'),
        h('button', { type: 'button', className: 'wp-gt-btn wp-gt-danger', onClick: accept }, confirmLabel),
      ),
    );
    id = gooeyToast.warning(title, {
      description: body,
      icon: icon('warning'),
      classNames: { wrapper: 'wp-gt wp-gt-confirm' },
      showTimestamp: false,
      timing: { displayDuration: CONFIRM_MS },
      onDismiss,
    });
    return id;
  };

  return {
    on,
    success: (title, description, legacy) => notify('success', title, description, legacy),
    error: (title, description, legacy) => notify('error', title, description, legacy),
    warning: (title, description, legacy) => notify('warning', title, description, legacy),
    info: (title, description, legacy) => notify('info', title, description, legacy),
    confirm,
    dismiss: (id) => gooeyToast.dismiss(id),
  };
}
