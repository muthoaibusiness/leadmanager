import { useEffect, useRef } from 'react';
import { gooeyToast } from 'goey-toast';
import { useProjectToast } from '../components/project/projectToast.js';

// Close guard for a form modal — the structure of Projects → Add Property.
// ✕, Cancel, the backdrop and Esc all close through requestClose(). An
// untouched form just closes; one with anything typed asks first (goey-toast
// confirmation), so an outside click can no longer throw the input away.
// A save in flight (`busy`) blocks closing.
//
//   const g = useDiscardGuard({ isOpen, isDirty, onClose: closeModal, ask: { title, description } });
//   <div className="mov on" {...g.backdropProps}>
//     <div className="modal" {...g.modalProps}> … onClick={g.requestClose} …
//
// The question shows in the goey host (ProjectsToaster), which is mounted on
// every tab and portalled to <body>, outside the form and its backdrop.
export default function useDiscardGuard({ isOpen, isDirty, onClose, busy = false, ask }) {
  const toast = useProjectToast();
  const askIdRef = useRef(null);      // the open confirmation toast; non-null = asking
  const askReturnRef = useRef(null);  // what had focus before it opened
  const backdropRef = useRef(false);  // this press started (and ended) on the backdrop

  // Closed some other way (another modal opened over it): its question goes too.
  useEffect(() => {
    if (isOpen) return;
    if (askIdRef.current != null) gooeyToast.dismiss(askIdRef.current);
    askIdRef.current = null;
    askReturnRef.current = null;
  }, [isOpen]);

  const dropAsk = () => {
    const id = askIdRef.current;
    askIdRef.current = null;
    if (id != null) toast.dismiss(id);
  };
  const closeNow = () => {
    dropAsk();
    askReturnRef.current = null;
    onClose();
  };
  // Stay (and Esc) hand focus back to where it was, so typing carries on.
  const cancelAsk = () => {
    const el = askReturnRef.current;
    askReturnRef.current = null;
    dropAsk();
    if (el && el.isConnected && el !== document.body) el.focus({ preventScroll: true });
  };
  const askDiscard = () => {
    if (askIdRef.current != null) return; // already asking: never stack a second toast
    askReturnRef.current = document.activeElement;
    // Ask with nothing focused. goey's host hands focus back to whatever had
    // it when focus leaves the toast, so a click into a field would be pulled
    // back to ✕ / Cancel. cancelAsk restores focus itself.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    askIdRef.current = toast.confirm({
      title: ask.title,
      description: ask.description,
      confirmLabel: 'Exit',
      cancelLabel: 'Stay',
      onConfirm: closeNow,
      onCancel: cancelAsk,
      onDismiss: (id) => { if (askIdRef.current === id) askIdRef.current = null; },
    });
  };
  const requestClose = () => {
    if (busy) return;
    if (isDirty()) { askDiscard(); return; }
    closeNow();
  };
  // Pressing or typing anywhere in the form puts the question away, so editing
  // carries on without a Stay first. Tab and modifier keys don't, which keeps
  // the toast's buttons reachable from the keyboard.
  const dismissAsk = (e) => {
    if (askIdRef.current == null) return;
    if (e.type === 'keydown' && ['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    askReturnRef.current = null;
    dropAsk();
  };
  // Capture phase, so this runs before App.jsx's global Esc handler (which
  // would close the modal directly and skip the check above) and before goey's
  // own Escape handler. Esc first backs out of an open confirmation.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (askIdRef.current != null) cancelAsk();
      else requestClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return {
    requestClose,
    // Outside click = pressed AND released on the backdrop. A text selection
    // dragged across the modal edge is clicked on .mov too, and must not count.
    backdropProps: {
      onPointerDown: e => { backdropRef.current = e.target === e.currentTarget; },
      onPointerUp: e => { backdropRef.current = backdropRef.current && e.target === e.currentTarget; },
      onClick: e => { if (backdropRef.current && e.target === e.currentTarget) requestClose(); backdropRef.current = false; },
    },
    modalProps: { onPointerDownCapture: dismissAsk, onKeyDownCapture: dismissAsk },
  };
}
