import useMediaQuery from './useMediaQuery.js';

// True below 768px: the width where the phone layout (bottom bar, header pills,
// phone Home) takes over. Same breakpoint as the phone CSS in index.css.
export const PHONE_MQ = '(max-width: 767px)';

export default function useIsPhone() {
  return useMediaQuery(PHONE_MQ);
}
