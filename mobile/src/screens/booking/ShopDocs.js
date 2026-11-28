// A unit's Documents and History tabs: the phone version of the web's
// src/components/booking/ShopDocs.jsx (DocsTab, HistoryTab) and DocViewer.jsx.
//
// Documents: the kit by stage, a dot per item (ready / draft / missing), view, and a
// send box. "Send" goes out on WhatsApp through the same relay as Conversations, from
// the number the customer already chats with, and is logged in History. The send
// steps (one text for the documents made for the unit, then each file, ten seconds
// apart, a refused message tried once more) are copied from the web's send().
// Management approves standard texts and sets the brochure link here; uploading files
// and building the floor-plan document from the brochure stay on the web.
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { Button, Card, Field, Icon, Row, T, useUI } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { saveProject } from '../../../../src/lib/projects.js';
import {
  DOCS, DSTAGE, docReady, docState, stageOf, genText, genDoc, kitDoc, fileKind, approveKit, addShopLog, docKey, brochureLink,
} from '../../../../src/lib/shopDocs.js';
import { waAccountFor, waConversationForLead, waSendMessage, waRetry, waLoadSettings, WA_ACCOUNT_LABEL } from '../../../../src/lib/wa.js';
import { fmtAgo } from '../../../../src/lib/helpers.js';
import { fullUrl, when } from './bits';

const GAP_MS = 10000; // the web's GAP_MS: Wasender refuses messages closer than about 6 s
const canManage = (u) => u?.role === 'MANAGEMENT' || u?.role === 'MASTER';
const mask = (c) => (/@/.test(c) ? c.replace(/^(.).*(@.*)$/, '$1•••$2') : c.length > 6 ? c.slice(0, 3) + '•••' + c.slice(-3) : c);
const dotColor = (t, c) => (c === 'ok' ? t.brand : c === 'warn' ? t.warn : t.mute);

// A made-on-the-spot document (quotation, unit sheet, template) is HTML on the web; the phone
// shows its text.
const htmlText = (html) => String(html || '')
  .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|tr|div)>/gi, '\n').replace(/<\/t[dh]>/gi, '   ')
  .replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const open = (url) => { if (url) Linking.openURL(fullUrl(url)).catch(() => {}); };

// DocViewer.jsx, inside the sheet instead of a pop-up.
function DocView({ doc, project, shop, floorName, entry, manage, busy, onApprove, onSaveLink, onBack }) {
  const t = useTheme();
  const [link, setLink] = useState(brochureLink(project));
  const [saving, setSaving] = useState(false);
  const plans = entry?.plans || null;
  const ext = !entry?.url && entry?.link ? entry.link : '';
  const file = entry?.url ? entry : null;
  const html = file ? '' : doc.t === 'gen' ? genDoc(doc.k, project, shop, floorName) : kitDoc(doc, project, shop, floorName, !!entry?.approved);
  const canApprove = manage && doc.t === 'tpl' && !file && !plans && !ext;
  return (
    <View style={{ gap: space.md }}>
      <Pressable onPress={onBack} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}>
        <Icon name="arrow-back" size={18} color={t.brand} /><T v="small" color={t.brand} style={{ fontWeight: '600' }}>All documents</T>
      </Pressable>
      <T v="h2">{`${doc.n}, shop ${shop.code}`}</T>
      {plans ? plans.map((p) => (
        <Pressable key={p.name} onPress={() => open(p.url)} style={{ gap: 4 }}>
          <Image source={{ uri: p.url }} resizeMode="contain" style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: '#fff' }} />
          <T v="small" tone="sub">{p.name} · tap to open</T>
        </Pressable>
      )) : ext ? (
        <Button label="Open link" icon="open-in-new" onPress={() => open(ext)} />
      ) : file ? (
        file.mime?.startsWith('image/')
          ? <Pressable onPress={() => open(file.url)}><Image source={{ uri: file.url }} resizeMode="contain" style={{ width: '100%', height: 300, borderRadius: radius.md, backgroundColor: '#fff' }} /></Pressable>
          : <Button label="Open file" icon="open-in-new" onPress={() => open(file.url)} />
      ) : (
        <Card><T v="small" selectable>{htmlText(html)}</T></Card>
      )}
      {canApprove ? (entry?.approved
        ? <Button label="Withdraw approval" variant="ghost" disabled={busy} onPress={() => onApprove(false)} />
        : <Button label="Approve for clients" variant="soft" disabled={busy} onPress={() => onApprove(true)} />) : null}
      {doc.k === 'brochure' && manage ? (
        <View style={{ gap: space.sm }}>
          <Field label={`Brochure link for ${project.name}`} value={link} onChangeText={setLink} placeholder="https://drive.google.com/file/d/…" autoCapitalize="none" />
          <Button label={saving ? 'Saving…' : 'Save link'} variant="soft" disabled={saving || link.trim() === brochureLink(project)}
            onPress={async () => { setSaving(true); await onSaveLink(link.trim()); setSaving(false); }} />
        </View>
      ) : null}
      {doc.k === 'floorplans' && manage ? <T v="small" tone="mute">Building this document from the brochure is done on the web.</T> : null}
    </View>
  );
}

export function DocsTab({ project, shop, floorName, store, client: picked }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const t = useTheme();
  const { lib, missing, loaded, cid, reload } = store;
  const stage = stageOf(shop);
  const first = (d) => docReady(d, lib) && (d.stage === stage || (stage !== 'pre' && d.stage === 'pre' && d.t === 'gen'));
  const [pick, setPick] = useState({ code: null, set: new Set() });
  const sel = pick.code === shop.code ? pick.set : new Set(DOCS.filter(first).map((d) => d.k));
  const setSel = (s) => setPick({ code: shop.code, set: s });
  const [view, setView] = useState(null);
  const client = picked?.name || shop.clientName || '';
  const [from, setFrom] = useState('');
  const [wa, setWa] = useState(null);
  useEffect(() => { let dead = false; waLoadSettings().then((s) => { if (!dead) setWa(s); }).catch(() => {}); return () => { dead = true; }; }, []);
  useEffect(() => {
    let dead = false;
    if (picked?.phone) waAccountFor(picked, user).then((a) => { if (!dead) setFrom(a); });
    return () => { dead = true; };
  }, [picked, user]);
  const fromLabel = picked?.phone && from ? WA_ACCOUNT_LABEL[from] : '';
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState('');
  const manage = canManage(user);

  const ready = DOCS.filter((d) => docReady(d, lib)).length;
  const toggle = (k) => { const s = new Set(sel); if (s.has(k)) s.delete(k); else s.add(k); setSel(s); };
  const chosen = DOCS.filter((d) => sel.has(d.k) && docReady(d, lib));

  const approve = async (k, on = true) => {
    setBusy(true);
    const ok = await approveKit(cid, docKey(k, project), user, on);
    setBusy(false);
    if (ok) { reload(); toast(on ? 'Approved. It can now be sent to clients.' : 'Approval withdrawn.', 'ok'); } else toast('Could not change the approval', 'err');
  };
  const saveBrochure = async (url) => {
    const keep = (project.media?.links || []).filter((l) => !/brochure/i.test(l.label || ''));
    const r = await saveProject(project.id, { media: { ...project.media, links: url ? [...keep, { label: 'Brochure', url }] : keep } });
    if (r.ok) { refresh(); reload(); toast(url ? 'Brochure link saved for this project' : 'Brochure link removed', 'ok'); } else toast(`Not saved: ${r.error}`, 'err');
    return r.ok;
  };

  const send = async () => {
    if (!picked?.phone || !chosen.length || sending) return;
    if (wa && wa.enabled === false) { toast('WhatsApp chat is switched off in Chat Settings.', 'err'); return; }
    setSending('Sending…');
    const res = await waConversationForLead(picked, user);
    if (!res.ok) { setSending(''); toast(res.error, 'err'); return; }
    const conv = res.conversation;
    const sent = [];
    const gen = chosen.filter((d) => d.t === 'gen');
    const files = chosen.filter((d) => lib[d.k]?.url || lib[d.k]?.plans || lib[d.k]?.link);
    let failed = '';
    const total = (gen.length ? 1 : 0) + files.length;
    let last = 0; let n = 0;
    const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const go = async (payload) => {
      const w = GAP_MS - (Date.now() - last);
      if (n && w > 0) await pause(w);
      setSending(`Sending ${++n} of ${total}…`);
      let r = await waSendMessage(wa, { conversation: conv, user, ...payload });
      last = Date.now();
      if (!r.ok && r.optimistic) {
        setSending(`Waiting ${Math.round(GAP_MS / 1000)}s to try again…`);
        await pause(GAP_MS);
        r = await waRetry(wa, r.optimistic, conv, user);
        last = Date.now();
      }
      if (!r.ok && !failed) failed = r.error || 'A message failed.';
      return r.ok;
    };
    if (gen.length) {
      const text = [`Hello ${client},`, '', project.name, ...gen.map((d) => '\n' + genText(d.k, project, shop, floorName))].join('\n');
      if (await go({ type: 'text', body: text })) gen.forEach((d) => sent.push(d.k));
    }
    for (const d of files) {
      const L = lib[d.k];
      if (L.link && !L.url) {
        if (await go({ type: 'text', body: `${d.n}: ${fullUrl(L.link)}` })) sent.push(d.k);
        continue;
      }
      if (L.plans) {
        let all = true;
        for (const p of L.plans) if (!(await go({ type: 'image', body: `${project.name} · ${p.name}`, mediaUrl: p.url, mediaMime: p.mime, mediaName: `${p.name}.${p.mime.split('/')[1] || 'jpg'}` }))) all = false;
        if (all) sent.push(d.k);
        continue;
      }
      if (await go({ type: fileKind(L.mime), body: d.n, mediaUrl: fullUrl(L.url), mediaMime: L.mime, mediaName: L.name || d.n, mediaSize: L.size })) sent.push(d.k);
    }
    const skipped = chosen.length - gen.length - files.length;
    if (sent.length) await addShopLog(cid, { propertyId: project.id, unitId: shop.code, kind: 'docs_sent', client, contact: mask(picked.phone), channel: `WhatsApp · ${WA_ACCOUNT_LABEL[conv.account] || conv.account}`, docs: sent }, user);
    setSending('');
    if (sent.length) reload();
    toast(failed || `${sent.length} document${sent.length > 1 ? 's' : ''} sent to ${client} from ${WA_ACCOUNT_LABEL[conv.account]}${skipped ? ` (${skipped} have no file yet)` : ''}`, failed ? 'err' : 'ok');
  };

  if (!loaded) return <T v="small" tone="mute">Loading documents…</T>;
  if (missing) return <Card><T v="strong">Document kit is not set up</T><T v="small" tone="sub">Apply supabase/migrations/0071_shop_docs.sql to turn it on.</T></Card>;

  const viewDoc = view && DOCS.find((d) => d.k === view);
  if (viewDoc) {
    return <DocView doc={viewDoc} project={project} shop={shop} floorName={floorName} entry={lib[viewDoc.k]} manage={manage} busy={busy}
      onApprove={(on) => approve(viewDoc.k, on)} onSaveLink={saveBrochure} onBack={() => setView(null)} />;
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="strong">{`${ready} of ${DOCS.length} ready`}</T>
          <Row gap={10}>
            {[['ok', 'Ready'], ['warn', 'Draft'], ['miss', 'Missing']].map(([c, l]) => (
              <Row key={c} gap={4}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor(t, c) }} /><T v="tiny" tone="sub">{l}</T></Row>
            ))}
          </Row>
        </Row>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line, overflow: 'hidden' }}>
          <View style={{ width: `${(ready / DOCS.length) * 100}%`, height: 6, backgroundColor: t.brand }} />
        </View>
      </View>

      {Object.keys(DSTAGE).map((g) => (
        <View key={g} style={{ gap: space.xs }}>
          <T v="tiny" tone={g === stage ? undefined : 'mute'} color={g === stage ? t.brand : undefined} style={{ fontWeight: '700' }}>{DSTAGE[g].toUpperCase()}</T>
          <Card pad={false}>
            {DOCS.filter((d) => d.stage === g).map((d, i, arr) => {
              const ok = docReady(d, lib);
              const [c, label] = docState(d, lib);
              const on = sel.has(d.k) && ok;
              return (
                <View key={d.k} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: space.md, gap: space.sm, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: t.line, opacity: ok ? 1 : 0.6 }}>
                  <Pressable onPress={ok ? () => toggle(d.k) : undefined} disabled={!ok} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !ok }}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
                    <Icon name={on ? 'check-box' : 'check-box-outline-blank'} size={22} color={on ? t.brand : t.mute} />
                    <T v="small" style={{ flex: 1 }} numberOfLines={2}>{d.n}</T>
                    <View accessibilityLabel={label} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor(t, c) }} />
                  </Pressable>
                  <Pressable onPress={() => setView(d.k)} accessibilityRole="button" accessibilityLabel={`View ${d.n}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="visibility" size={20} color={t.sub} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </View>
      ))}

      <Card style={{ gap: space.sm }}>
        {picked ? (
          <View>
            <T v="tiny" tone="mute">SEND TO</T>
            <T v="strong">{client}</T>
            <T v="small" tone="sub">{picked.phone ? `${picked.phone}${fromLabel ? ` · from ${fromLabel}` : ''}` : 'No phone number'}</T>
          </View>
        ) : <T v="small" tone="mute">Choose a customer above to send documents.</T>}
        <Button label={sending || (chosen.length ? `Send ${chosen.length} document${chosen.length > 1 ? 's' : ''} on WhatsApp` : 'Select documents')}
          icon="send" disabled={!chosen.length || !picked?.phone || !!sending} busy={!!sending} onPress={send} />
        <T v="small" tone="mute">{manage ? 'Files are uploaded on the web.' : 'Management adds and approves the files.'}</T>
      </Card>
    </View>
  );
}

export function HistoryTab({ project, shop, store }) {
  const { user } = useApp();
  const { toast } = useUI();
  const t = useTheme();
  const { log, missing, loaded, cid, reload } = store;
  const [note, setNote] = useState('');
  const save = async () => {
    const v = note.trim();
    if (!v) return;
    const ok = await addShopLog(cid, { propertyId: project.id, unitId: shop.code, kind: 'note', note: v }, user);
    if (ok) { setNote(''); reload(); } else toast('Could not save the note', 'err');
  };
  if (!loaded) return <T v="small" tone="mute">Loading history…</T>;
  if (missing) return <Card><T v="strong">History is not set up</T><T v="small" tone="sub">Apply supabase/migrations/0071_shop_docs.sql to turn it on.</T></Card>;
  return (
    <View style={{ gap: space.md }}>
      {shop.status === 'hold' ? (
        <Card style={{ backgroundColor: t.warnSoft }}>
          <T v="small">{`On hold${shop.clientName ? ` for ${shop.clientName}` : ''}${shop.holdUntil ? ` · until ${new Date(shop.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}`}</T>
        </Card>
      ) : null}
      {log.length ? (
        <Card pad={false}>
          {log.map((a, i) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderBottomWidth: i === log.length - 1 ? 0 : 1, borderBottomColor: t.line }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: a.kind === 'docs_sent' ? t.brandSoft : t.infoSoft }}>
                <T v="tiny" style={{ fontWeight: '700' }}>{a.kind === 'docs_sent' ? 'D' : 'N'}</T>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T v="strong">{a.kind === 'docs_sent' ? 'Documents sent' : 'Note'}</T>
                  <T v="tiny" tone="mute">{fmtAgo(a.at) || when(a.at)}</T>
                </Row>
                <T v="small" tone="sub">{`${a.client ? `${a.client} · ` : ''}${a.by}`}</T>
                {a.kind === 'docs_sent' ? <T v="small" tone="sub">{`${a.docs.length} documents · ${a.channel}${a.contact ? ` · ${a.contact}` : ''}`}</T> : null}
                {a.note ? <T v="small">{a.note}</T> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : <T v="small" tone="mute" style={{ textAlign: 'center' }}>No activity yet</T>}
      <Row style={{ alignItems: 'flex-end' }}>
        <Field label="Add a note" style={{ flex: 1 }} value={note} onChangeText={setNote} placeholder="Add a note" onSubmitEditing={save} returnKeyType="done" />
        <Button label="Save" variant="soft" full={false} disabled={!note.trim()} onPress={save} />
      </Row>
    </View>
  );
}
