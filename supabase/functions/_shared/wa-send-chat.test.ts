// node --test — who may send through wa-send, decided on the server
// (checkWaSend in wa-send-auth.ts). The browser rule (waCanChat / isLeadAssignedOrForwardedTo
// in src/lib/wa.js) is UX only; this is the boundary. Rows are scripted here.
//   * chat switched off, or an account outside the conversation's company: 403
//   * MANAGEMENT/MASTER: any conversation of their company (Master: all)
//   * anyone else: only a conversation linked to a lead assigned to them, or
//     previously assigned to them, or (Team Lead) on their team; and the
//     conversation's phone must be the lead's phone
//   * conversationId must exist; clientRef must be this sender's own PENDING
//     outbound message in that conversation; `to` must be the thread's phone
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWaSend, claimSend, type ChatDeps } from "./wa-send-auth.ts";

const conv = (o: any = {}) => ({ id: "eyad:8801711111111@s.whatsapp.net", phone: "8801711111111", account: "eyad", company_id: null, lead_id: "L1", ...o });
const lead = (o: any = {}) => ({ id: "L1", company_id: "c1", assigned_to: "agent", previous_assignees: [], team_id: "t1", phone: "+8801711111111", ...o });
const msg = (o: any = {}) => ({ id: "m1", conversation_id: conv().id, direction: "OUT", status: "PENDING", sent_by: "agent", ...o });
const who = (o: any = {}) => ({ id: "agent", name: "A", role: "AGENT", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null, ...o });

function deps(o: { conv?: any; lead?: any; msg?: any; settings?: any; byPhone?: any[] } = {}): ChatDeps {
  return {
    conversation: async () => ("conv" in o ? o.conv : conv()),
    lead: async () => ("lead" in o ? o.lead : lead()),
    leadsByPhone: async () => o.byPhone ?? [],
    message: async () => ("msg" in o ? o.msg : msg()),
    settings: async () => ("settings" in o ? o.settings : { enabled: true, company_id: "c1" }),
  };
}
const body = (o: any = {}) => ({ action: "send", conversationId: conv().id, clientRef: "m1", to: "8801711111111", ...o });
const status = async (actor: any, b: any, d: ChatDeps) => (await checkWaSend(actor, b, d)).status;

test("the assigned agent may send to its own lead's thread", async () => {
  assert.equal(await status(who(), body(), deps()), 200);
});

test("previously assigned agent and same-team Team Lead may send; another agent may not", async () => {
  assert.equal(await status(who({ id: "old" }), body(), deps({ lead: lead({ previous_assignees: ["old"] }), msg: msg({ sent_by: "old" }) })), 200);
  assert.equal(await status(who({ id: "tl", role: "TEAM_LEAD" }), body(), deps({ msg: msg({ sent_by: "tl" }) })), 200);
  assert.equal(await status(who({ id: "tl2", role: "TEAM_LEAD", team_id: "t2" }), body(), deps({ msg: msg({ sent_by: "tl2" }) })), 403);
  assert.equal(await status(who({ id: "stranger" }), body(), deps({ msg: msg({ sent_by: "stranger" }) })), 403);
});

test("Management sends to any thread of its company, never another company's", async () => {
  const mgr = who({ id: "mgr", role: "MANAGEMENT", team_id: null });
  assert.equal(await status(mgr, body(), deps({ lead: lead({ assigned_to: "x" }), msg: msg({ sent_by: "mgr" }) })), 200);
  assert.equal(await status(mgr, body(), deps({ conv: conv({ lead_id: null }), msg: msg({ sent_by: "mgr" }) })), 200, "unlinked thread, own company");
  assert.equal(await status(mgr, body(), deps({ conv: conv({ company_id: "c2" }), msg: msg({ sent_by: "mgr" }) })), 403, "thread owned by c2");
  assert.equal(await status(mgr, body(), deps({ lead: lead({ company_id: "c2" }), msg: msg({ sent_by: "mgr" }) })), 403, "lead owned by c2");
});

test("Master sends anywhere", async () => {
  const m = who({ id: "ms", role: "MASTER", company_id: null, team_id: null });
  assert.equal(await status(m, body(), deps({ conv: conv({ company_id: "c2" }), lead: lead({ company_id: "c2" }), msg: msg({ sent_by: "ms" }) })), 200);
});

test("an agent cannot use a thread with no lead, or a lead of another company", async () => {
  assert.equal(await status(who(), body(), deps({ conv: conv({ lead_id: null }) })), 403);
  assert.equal(await status(who(), body(), deps({ lead: null })), 403, "dangling lead id");
  assert.equal(await status(who({ company_id: "c2" }), body(), deps()), 403);
});

test("chat switched off in wa_settings refuses everyone", async () => {
  assert.equal(await status(who({ role: "MANAGEMENT", id: "mgr" }), body(), deps({ settings: { enabled: false }, msg: msg({ sent_by: "mgr" }) })), 403);
});

test("conversation must exist; to must be its phone; a linked lead's phone must match the thread", async () => {
  assert.equal(await status(who(), body(), deps({ conv: null })), 404);
  assert.equal(await status(who(), body({ to: "8801799999999" }), deps()), 403, "to rewritten to another number");
  assert.equal(await status(who(), body(), deps({ lead: lead({ phone: "+8801799999999" }) })), 403, "thread phone is not the lead's");
  assert.equal(await status(who(), body({ to: "+880 1711-111111" }), deps()), 200, "formatting differences are fine");
});

test("clientRef must be the sender's own PENDING outbound message in that conversation", async () => {
  assert.equal(await status(who(), body(), deps({ msg: null })), 404);
  assert.equal(await status(who({ id: "mgr", role: "MANAGEMENT" }), body(), deps({ msg: msg({ sent_by: "someone-else" }) })), 200, "an admin viewing as another account sends that account's message");
  assert.equal(await status(who(), body(), deps({ msg: msg({ conversation_id: "eyad:other@s.whatsapp.net" }) })), 403);
  assert.equal(await status(who(), body(), deps({ msg: msg({ sent_by: "someone-else" }) })), 403);
  assert.equal(await status(who(), body(), deps({ msg: msg({ direction: "IN" }) })), 403);
  assert.equal(await status(who(), body(), deps({ msg: msg({ status: "SENT" }) })), 409, "no resend of a delivered message");
});

test("no owner company for the numbers (missing wa_settings, or no company_id): only Master may send", async () => {
  const mgr = who({ id: "mgr", role: "MANAGEMENT", team_id: null });
  const unlinked = { conv: conv({ lead_id: null }), msg: msg({ sent_by: "mgr" }) };
  assert.equal(await status(mgr, body(), deps({ ...unlinked, settings: null })), 403, "no wa_settings row");
  assert.equal(await status(mgr, body(), deps({ ...unlinked, settings: { enabled: true, company_id: null } })), 403, "no owner company");
  const ms = who({ id: "ms", role: "MASTER", company_id: null, team_id: null });
  assert.equal(await status(ms, body(), deps({ ...unlinked, settings: { enabled: true, company_id: null }, msg: msg({ sent_by: "ms" }) })), 200);
});

test("a thread with no lead_id: an agent may send when it holds the lead with that phone (as the UI matches it)", async () => {
  const unlinked = conv({ lead_id: null });
  assert.equal(await status(who(), body(), deps({ conv: unlinked, byPhone: [lead()] })), 200, "matched by phone");
  assert.equal(await status(who(), body(), deps({ conv: unlinked, byPhone: [lead({ assigned_to: "x" })] })), 403, "a lead it does not hold");
  assert.equal(await status(who(), body(), deps({ conv: unlinked, byPhone: [lead({ company_id: "c2" })] })), 403, "another company's lead");
  assert.equal(await status(who(), body(), deps({ conv: unlinked, byPhone: [lead({ phone: "+8801799999999" })] })), 403, "a different number");
});

test("the message goes to the thread's own number, never the raw body value", async () => {
  const r = await checkWaSend(who(), body({ to: "8801711111111@g.us" }), deps());
  assert.equal(r.status, 200);
  assert.equal(r.to, "8801711111111");
});

test("missing or non-string ids are 400", async () => {
  for (const b of [body({ conversationId: undefined }), body({ clientRef: 7 }), body({ to: "" })]) assert.equal(await status(who(), b, deps()), 400);
});

test("a lookup failure fails closed", async () => {
  const d = { ...deps(), lead: async () => { throw new Error("db down"); } };
  await assert.rejects(checkWaSend(who(), body(), d));
});

test("claimSend: two concurrent sends of one message, only one wins (no double WhatsApp)", async () => {
  let status = "PENDING";
  const patch = async (filter: string, body: any) => {
    await new Promise((r) => setTimeout(r, 5));
    if (!filter.includes("status=eq.PENDING") || status !== "PENDING") return [];
    status = body.status; return [{ id: "m1" }];
  };
  const [a, b] = await Promise.all([claimSend("m1", patch), claimSend("m1", patch)]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(status, "SENDING");
});
