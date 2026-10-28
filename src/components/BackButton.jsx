import { useApp } from '../context/AppContext.jsx';
import Mi from './Mi.jsx';

// The header's Back button (a plain ←), ahead of the breadcrumb. Where it goes is
// decided once, in useNavHistory: the previous page in this tab's history, else
// the page above this one. Renders nothing on the account's home page.
export default function BackButton() {
  const { navBack } = useApp();
  if (!navBack) return null;
  return (
    <button type="button" className="hd-back" onClick={navBack.go} aria-label={`Back to ${navBack.label}`} title={`Back to ${navBack.label}`}>
      {/* Phones show the chevron in a round button instead (index.css). */}
      <Mi aria-hidden="true" className="hd-back-arrow">arrow_back</Mi>
      <Mi aria-hidden="true" className="hd-back-chev">chevron_left</Mi>
    </button>
  );
}
