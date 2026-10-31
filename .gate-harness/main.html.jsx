import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import LeadPanel from '../src/components/LeadPanel.jsx';
import FollowUpModal from '../src/components/modals/FollowUpModal.jsx';
import { Ctx } from './appContextStub.jsx';

function Host() {
  const [sel, setSel] = useState('L1');
  const [modal, setModal] = useState('follow-up');
  const [toast, setToast] = useState(null);
  const [ver, setVer] = useState(0);
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('propcrm_v2')).users.find(u => u.id === 'u-agent'); }
    catch { return null; }
  })();
  const value = {
    user,
    view: 'leads',
    panLead: sel,
    setPanLead: setSel,
    modal, openModal: (m) => setModal(m), closeModal: () => setModal(null),
    refreshDB: () => setVer(v => v + 1),
    showToast: (msg) => setToast({ msg }),
    toast,
    sidebarOpen: false,
    setChatTarget: () => {}, chatOk: false,
  };
  return React.createElement(Ctx.Provider, { value },
    React.createElement('div', { 'data-ver': ver },
      React.createElement(LeadPanel, null),
      React.createElement(FollowUpModal, null),
      toast && React.createElement('div', { role: 'status' }, toast.msg)));
}

createRoot(document.getElementById('root')).render(React.createElement(Host));
