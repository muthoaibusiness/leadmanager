import { useApp } from '../context/AppContext.jsx';
import { newProjectDraft } from '../lib/projects.js';

// The ways into a project, shared by the Projects header, the project list's
// row menus and Available Units' Manage menu, so each one opens the same way.
export default function useProjectNav() {
  const { user, openModal, setPropSel, setPropDraft, setConsoleAdmin, setConsoleUnit, setProjTab, setPlanSel, setPlanEdit } = useApp();
  return {
    // The project console: the agent side (deals, holds) or the admin side (settings, units).
    openConsole: (projectId, admin = false, unit = null) => {
      setConsoleAdmin(admin);
      setConsoleUnit(unit);
      setPropSel(projectId);
      openModal('project-console');
    },
    // Available Units for one project, on All floors.
    openUnits: (projectId) => { setPlanSel({ projectId, planId: null }); setProjTab('units'); },
    // A new floor plan for a project; Available Units shows that project behind it.
    addFloorPlan: (projectId) => {
      setPlanSel({ projectId, planId: null });
      setProjTab('units');
      setPlanEdit({ projectId, planId: null });
      openModal('floorplan-editor');
    },
    editFloorPlan: (projectId, planId) => { setPlanEdit({ projectId, planId }); openModal('floorplan-editor'); },
    // Add Property: an unsaved draft, stored only once its catalog saves.
    addProperty: () => {
      const d = newProjectDraft(user?.companyId);
      setPropDraft(d);
      setConsoleAdmin(true);
      setConsoleUnit(null);
      setPropSel(d.id);
      openModal('project-console');
    },
  };
}
