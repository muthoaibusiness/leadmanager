import { useApp } from '../context/AppContext.jsx';
import { newProjectDraft } from '../lib/projects.js';

// The ways into a project, shared by the Projects header, the project list's
// row menus and Available Units' Manage menu, so each one opens the same way.
export default function useProjectNav() {
  const { user, nav, openModal, setPropSel, setPropDraft, setConsoleAdmin, setProjTab, setPlanSel, setPlanEdit } = useApp();
  return {
    // The project console: the agent side (deals, holds) or the admin side (settings, units).
    openConsole: (projectId, admin = false) => {
      setConsoleAdmin(admin);
      setPropSel(projectId);
      openModal('project-console');
    },
    // Available Units for one project, from any page (the phone Home's project cards too).
    openUnits: (projectId) => { nav('properties'); setPlanSel({ projectId, planId: null }); setProjTab('units'); },
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
      setPropSel(d.id);
      openModal('project-console');
    },
  };
}
