import { createPortal } from 'react-dom';
import { GooeyToaster } from 'goey-toast';
import 'goey-toast/styles.css';
import './projectToast.css';

// The Projects tab's one goey-toast host. PropertiesView renders it, so it only
// exists while that tab is open. Portalled to <body>: the page body is zoomed
// (.pg-body) and the toasts have to sit above the project console's overlay.
// Colours, type and spacing come from the app's tokens (projectToast.css), so
// `theme` only picks goey's base layer. A dismissed toast keeps its slot until
// it has animated out, so goey's default of 3 would queue a quick follow-up
// (even a confirmation) behind fading ones; 6 leaves room.
export default function ProjectsToaster() {
  return createPortal(
    <GooeyToaster position="top-center" theme="dark" offset={18} visibleToasts={6} showTimestamp={false} />,
    document.body,
  );
}
