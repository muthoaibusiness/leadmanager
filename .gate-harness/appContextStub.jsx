import React from 'react';

// Minimal AppContext stand-in for the gate harness: the real AppContext.jsx
// drags the whole app (useNavHistory, boot logic) into the bundle. LeadPanel /
// FollowUpModal / LogCall read only these fields off useApp().
export const Ctx = React.createContext(null);
export const useApp = () => React.useContext(Ctx) || {};

export function AppProvider({ children }) { return children; }
