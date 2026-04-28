import { ROLES, SRC_LABELS } from './constants.js';
import { dAgo, inMonth, uid as uidFn, now_, fmtBDT } from './helpers.js';

export const USERS = [
  { id: 'u1', name: 'Rahim Ahmed', email: 'rahim@crm.com', password: '1234', role: ROLES.IA, teamId: 't1', phone: '+880 1711 100001' },
  { id: 'u2', name: 'Nusrat Jahan', email: 'nusrat@crm.com', password: '1234', role: ROLES.IA, teamId: 't1', phone: '+880 1711 100002' },
  { id: 'u3', name: 'Fatima Begum', email: 'fatima@crm.com', password: '1234', role: ROLES.MA, teamId: 't1', phone: '+880 1711 100003' },
  { id: 'u4', name: 'Tariq Islam', email: 'tariq@crm.com', password: '1234', role: ROLES.MA, teamId: 't1', phone: '+880 1711 100004' },
  { id: 'u5', name: 'Masud Rahman', email: 'masud@crm.com', password: '1234', role: ROLES.TL, teamId: 't1', phone: '+880 1711 100005' },
  { id: 'u6', name: 'Admin', email: 'admin@crm.com', password: '1234', role: ROLES.MGMT, teamId: null, phone: '+880 1711 100006' },
];

export const TEAMS = [{ id: 't1', name: "Masud's Team", leadId: 'u5' }];

export const DEF_TARGETS = [
  { id: 'tg1', userId: 'u1', month: '2026-04', type: 'MEETINGS_SET', value: 15 },
  { id: 'tg2', userId: 'u2', month: '2026-04', type: 'MEETINGS_SET', value: 12 },
  { id: 'tg3', userId: 'u3', month: '2026-04', type: 'SITE_VISITS', value: 8 },
  { id: 'tg4', userId: 'u4', month: '2026-04', type: 'SITE_VISITS', value: 10 },
];

export function mkLead(id, name, phone, email, co, src, status, aTo, aName, aRole, prev, prop, budget, dv, ds, msb, msd, svb, svd, upd, cAt) {
  return {
    id, name, phone, email, company: co, source: src, status,
    assignedTo: aTo, assignedToName: aName, assignedRole: aRole,
    teamId: 't1', previousAssignees: prev,
    propertyInterest: prop, budget,
    dealValue: dv || 0, dealStatus: ds || null,
    meetingSetBy: msb || null, meetingSetDate: msd || null,
    siteVisitDoneBy: svb || null, siteVisitDoneDate: svd || null,
    notes: '', createdAt: cAt || dAgo(20), updatedAt: upd || dAgo(1),
    callCount: Math.ceil(Math.random() * 8 + 1),
    smsCount: Math.ceil(Math.random() * 4),
    whatsappCount: Math.ceil(Math.random() * 5),
    visitCount: svd ? 1 : 0,
    meetingDate: svd || null, meetingLocation: '',
  };
}

export const DEF_LEADS = [
  mkLead('l1', 'Aminul Islam', '+880 1811 001001', 'aminul@example.com', 'Aminul Traders', 'META_ADS', 'NEW', 'u1', 'Rahim Ahmed', ROLES.IA, [], '3BHK Apartment, Bashundhara R/A', 8500000, 0, null, null, null, null, null, inMonth(18), dAgo(20)),
  mkLead('l2', 'Taslima Khatun', '+880 1822 002002', 'taslima@gmx.com', '—', 'WHATSAPP_ADS', 'CONTACTED', 'u1', 'Rahim Ahmed', ROLES.IA, [], '2BHK Apartment, Mirpur DOHS', 6200000, 0, null, null, null, null, null, inMonth(17), dAgo(18)),
  mkLead('l3', 'Ripon Miah', '+880 1833 003003', 'ripon@mail.com', 'Ripon & Co', 'LINKEDIN', 'INTERESTED', 'u1', 'Rahim Ahmed', ROLES.IA, [], 'Duplex, Uttara Sector 7', 12500000, 0, null, null, null, null, null, inMonth(15), dAgo(15)),
  mkLead('l4', 'Nasrin Akter', '+880 1844 004004', 'nasrin@bd.com', '—', 'META_ADS', 'CONTACTED', 'u1', 'Rahim Ahmed', ROLES.IA, [], '4BHK Apartment, Gulshan 2', 18000000, 0, null, null, null, null, null, inMonth(14), dAgo(14)),
  mkLead('l5', 'Shamim Ahmed', '+880 1855 005005', 'shamim@tech.com', 'ShaTech', 'WHATSAPP_ADS', 'NEW', 'u1', 'Rahim Ahmed', ROLES.IA, [], '2BHK Apartment, Mohakhali', 5800000, 0, null, null, null, null, null, inMonth(19), dAgo(1)),
  mkLead('l6', 'Karim Chowdhury', '+880 1866 006006', 'karim@biz.com', 'KC Biz', 'META_ADS', 'SITE_VISIT_DONE', 'u3', 'Fatima Begum', ROLES.MA, ['u1'], '3BHK Apartment, Bashundhara R/A', 9500000, 0, null, 'u1', inMonth(5), 'u3', inMonth(10), inMonth(12), dAgo(8)),
  mkLead('l7', 'Delwar Hossain', '+880 1877 007007', 'delwar@h.com', '—', 'WHATSAPP_ADS', 'SITE_VISIT_SCHEDULED', 'u3', 'Fatima Begum', ROLES.MA, ['u1'], 'Commercial Space, Gulshan 1', 22000000, 0, null, 'u1', inMonth(6), null, null, inMonth(18), dAgo(3)),
  mkLead('l8', 'Sumaiya Begum', '+880 1888 008008', 'sumaiya@co.com', 'SB Ltd', 'LINKEDIN', 'SITE_VISIT_DONE', 'u4', 'Tariq Islam', ROLES.MA, ['u1'], 'Plot, Purbachal', 15000000, 0, null, 'u1', inMonth(4), 'u4', inMonth(9), inMonth(11), dAgo(9)),
  mkLead('l9', 'Rafiq Islam', '+880 1899 009009', 'rafiq@mail.com', 'RI Group', 'META_ADS', 'SITE_VISIT_SCHEDULED', 'u4', 'Tariq Islam', ROLES.MA, ['u1'], 'Duplex, Baridhara', 28000000, 0, null, 'u1', inMonth(7), null, null, inMonth(19), dAgo(1)),
  mkLead('l10', 'Jannatul Firdaus', '+880 1711 010010', 'jan@co.com', '—', 'WHATSAPP_ADS', 'NEGOTIATING', 'u5', 'Masud Rahman', ROLES.TL, ['u1', 'u3'], '4BHK Apartment, Gulshan 1', 32000000, 32000000, null, 'u1', inMonth(3), 'u3', inMonth(8), inMonth(10), dAgo(10)),
  mkLead('l11', 'Asif Mahmud', '+880 1722 011011', 'asif@bd.com', 'AM Corp', 'LINKEDIN', 'DEAL_CLOSED_WON', 'u5', 'Masud Rahman', ROLES.TL, ['u1', 'u4'], 'Duplex, Dhanmondi', 24000000, 24000000, 'WON', 'u1', inMonth(2), 'u4', inMonth(7), inMonth(9), dAgo(11)),
  mkLead('l12', 'Razzak Mollah', '+880 1733 012012', 'razzak@g.com', 'RM Intl', 'META_ADS', 'SITE_VISIT_SCHEDULED', 'u3', 'Fatima Begum', ROLES.MA, ['u1'], '3BHK Apartment, Banani', 11000000, 0, null, 'u1', inMonth(8), null, null, inMonth(18), dAgo(2)),
  mkLead('l13', 'Hafiz Uddin', '+880 1744 013013', 'hafiz@mail.com', '—', 'META_ADS', 'SITE_VISIT_DONE', 'u4', 'Tariq Islam', ROLES.MA, ['u1'], '2BHK Apartment, Mohakhali', 6500000, 0, null, 'u1', inMonth(5), 'u4', inMonth(12), inMonth(13), dAgo(7)),
  mkLead('l14', 'Razia Begum', '+880 1755 014014', 'razia@web.com', '—', 'META_ADS', 'CONTACTED', 'u2', 'Nusrat Jahan', ROLES.IA, [], '3BHK Apartment, Uttara', 8800000, 0, null, null, null, null, null, inMonth(16), dAgo(14)),
  mkLead('l15', 'Mizan Ahmed', '+880 1766 015015', 'mizan@co.com', 'MizAhmed', 'WHATSAPP_ADS', 'INTERESTED', 'u2', 'Nusrat Jahan', ROLES.IA, [], 'Commercial Space, Motijheel', 35000000, 0, null, null, null, null, null, inMonth(14), dAgo(12)),
  mkLead('l16', 'Rokeya Sultana', '+880 1777 016016', 'rokeya@mail.com', '—', 'LINKEDIN', 'NEW', 'u2', 'Nusrat Jahan', ROLES.IA, [], '2BHK Apartment, Mirpur 10', 5500000, 0, null, null, null, null, null, inMonth(18), dAgo(2)),
  mkLead('l17', 'Khaleda Islam', '+880 1788 017017', 'khaleda@biz.com', 'KI Ventures', 'META_ADS', 'SITE_VISIT_DONE', 'u3', 'Fatima Begum', ROLES.MA, ['u2'], '4BHK Apartment, Baridhara', 40000000, 0, null, 'u2', inMonth(3), 'u3', inMonth(7), inMonth(8), dAgo(12)),
  mkLead('l18', 'Shahadat Hossain', '+880 1799 018018', 'shahadat@h.com', '—', 'WHATSAPP_ADS', 'SITE_VISIT_DONE', 'u4', 'Tariq Islam', ROLES.MA, ['u2'], 'Duplex, Uttara', 18500000, 0, null, 'u2', inMonth(4), 'u4', inMonth(10), inMonth(11), dAgo(9)),
  mkLead('l19', 'Monira Khatun', '+880 1811 019019', 'monira@co.com', 'MK Ltd', 'LINKEDIN', 'SITE_VISIT_SCHEDULED', 'u3', 'Fatima Begum', ROLES.MA, ['u2'], '3BHK Apartment, Bashundhara', 9200000, 0, null, 'u2', inMonth(6), null, null, inMonth(19), dAgo(1)),
  mkLead('l20', 'Tofail Ahmed', '+880 1822 020020', 'tofail@corp.com', 'TA Corp', 'META_ADS', 'NEGOTIATING', 'u5', 'Masud Rahman', ROLES.TL, ['u2', 'u3'], 'Villa, Purbachal', 55000000, 55000000, null, 'u2', inMonth(2), 'u3', inMonth(6), inMonth(7), dAgo(13)),
  mkLead('l21', 'Selina Begum', '+880 1833 021021', 'selina@mail.com', '—', 'LINKEDIN', 'DEAL_CLOSED_WON', 'u5', 'Masud Rahman', ROLES.TL, ['u2', 'u4'], 'Commercial Space, Gulshan 2', 28000000, 28000000, 'WON', 'u2', inMonth(1), 'u4', inMonth(5), inMonth(6), dAgo(14)),
  mkLead('l22', 'Badrul Islam', '+880 1844 022022', 'badrul@co.com', 'BI Group', 'WHATSAPP_ADS', 'SITE_VISIT_DONE', 'u4', 'Tariq Islam', ROLES.MA, ['u2'], '3BHK Apartment, Mirpur DOHS', 7800000, 0, null, 'u2', inMonth(5), 'u4', inMonth(13), inMonth(14), dAgo(6)),
  mkLead('l23', 'Anwara Begum', '+880 1855 023023', 'anwara@web.com', '—', 'META_ADS', 'SITE_VISIT_DONE', 'u3', 'Fatima Begum', ROLES.MA, ['u2'], 'Duplex, Dhanmondi', 20000000, 0, null, 'u2', inMonth(6), 'u3', inMonth(14), inMonth(15), dAgo(5)),
  mkLead('l24', 'Mozammel Haq', '+880 1866 024024', 'mozam@corp.com', 'MH Corp', 'LINKEDIN', 'SITE_VISIT_DONE', 'u4', 'Tariq Islam', ROLES.MA, ['u2'], 'Plot, Keraniganj', 8000000, 0, null, 'u2', inMonth(7), 'u4', inMonth(15), inMonth(16), dAgo(4)),
  mkLead('l25', 'Rupali Akter', '+880 1877 025025', 'rupali@mail.com', '—', 'WHATSAPP_ADS', 'SITE_VISIT_SCHEDULED', 'u4', 'Tariq Islam', ROLES.MA, ['u2'], '2BHK Apartment, Shyamoli', 6000000, 0, null, 'u2', inMonth(9), null, null, inMonth(17), dAgo(3)),
  mkLead('l26', 'Wahida Sultana', '+880 1888 026026', 'wahida@biz.com', 'WS Biz', 'LINKEDIN', 'SITE_VISIT_DONE', 'u3', 'Fatima Begum', ROLES.MA, ['u2'], '3BHK Apartment, Gulshan 1', 17000000, 0, null, 'u2', inMonth(8), 'u3', inMonth(16), inMonth(17), dAgo(3)),
  mkLead('l27', 'Korban Ali', '+880 1899 027027', 'korban@co.com', 'KA Ltd', 'META_ADS', 'DEAL_CLOSED_LOST', 'u5', 'Masud Rahman', ROLES.TL, ['u2', 'u3'], 'Commercial Space, Motijheel', 30000000, 0, 'LOST', 'u2', inMonth(1), 'u3', inMonth(5), inMonth(6), dAgo(15)),
  mkLead('l28', 'Zaman Hossain', '+880 1711 028028', 'zaman@h.com', '—', 'WHATSAPP_ADS', 'DEAL_CLOSED_WON', 'u5', 'Masud Rahman', ROLES.TL, ['u1', 'u3'], '4BHK Apartment, DOHS', 38000000, 38000000, 'WON', 'u1', inMonth(2), 'u3', inMonth(6), inMonth(8), dAgo(12)),
];

export function genActs(lead) {
  const a = [];
  const find = id => USERS.find(u => u.id === id) || { id, name: 'Unknown', role: '' };
  const uid_act = () => 'a' + Math.random().toString(36).slice(2, 7);
  const push = (type, desc, uid, ts) => a.push({
    id: uid_act(), type, description: desc, userId: uid,
    userName: find(uid).name, timestamp: ts,
    durationSeconds: type === 'CALL' ? Math.floor(Math.random() * 600 + 60) : 0,
  });

  push('CREATED', 'Lead created from ' + SRC_LABELS[lead.source], 'system', lead.createdAt);

  if (['CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(lead.status)) {
    const ia = lead.previousAssignees[0] || lead.assignedTo;
    push('CALL', 'Initial contact call', ia, dAgo(parseInt(lead.createdAt ? 1 : 5)));
    push('STATUS_CHANGE', 'Status → Contacted', ia, lead.createdAt ? dAgo(1) : dAgo(3));
  }
  if (['INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(lead.status)) {
    const ia = lead.previousAssignees[0] || lead.assignedTo;
    push('CALL', 'Follow-up call — showed interest', ia, dAgo(2));
    push('STATUS_CHANGE', 'Status → Interested', ia, dAgo(2));
  }
  if (lead.meetingSetDate) {
    const ia = lead.meetingSetBy || lead.previousAssignees[0] || lead.assignedTo;
    push('FORWARDED', 'Lead forwarded to Meeting Agent', ia, lead.meetingSetDate);
    push('STATUS_CHANGE', 'Status → Meeting Set', ia, lead.meetingSetDate);
  }
  if (lead.siteVisitDoneDate) {
    const ma = lead.siteVisitDoneBy || lead.previousAssignees[1] || lead.assignedTo;
    if (['SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(lead.status)) {
      push('CALL', 'Confirming site visit details', ma, lead.meetingSetDate || dAgo(5));
    }
    push('VISIT', 'Site visit completed' + (lead.meetingLocation ? ' at ' + lead.meetingLocation : ''), ma, lead.siteVisitDoneDate);
    push('STATUS_CHANGE', 'Status → Site Visit Done', ma, lead.siteVisitDoneDate);
  }
  if (['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(lead.status)) {
    push('FORWARDED', 'Lead forwarded to Team Lead', lead.previousAssignees[1] || lead.assignedTo, lead.siteVisitDoneDate || dAgo(8));
    push('CALL', 'Negotiation call', lead.assignedTo, dAgo(6));
  }
  if (lead.status === 'NEGOTIATING') push('NOTE', 'Discussing payment plan and token amount', lead.assignedTo, dAgo(3));
  if (lead.status === 'DEAL_CLOSED_WON') push('DEAL', 'Deal CLOSED WON — ' + fmtBDT(lead.dealValue), lead.assignedTo, lead.updatedAt);
  if (lead.status === 'DEAL_CLOSED_LOST') push('STATUS_CHANGE', 'Deal CLOSED LOST', lead.assignedTo, lead.updatedAt);

  return a.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}
