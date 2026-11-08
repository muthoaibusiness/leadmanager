import { test } from "node:test";
import assert from "node:assert/strict";
import { metaTo, templatePayload, textPayload, metaResult } from "./meta-wa-core.ts";

test("the number goes to Meta as digits with the country code; a hidden-number id is refused", () => {
  assert.equal(metaTo("01866064500"), "8801866064500");
  assert.equal(metaTo("+880 1866-064500"), "8801866064500");
  assert.equal(metaTo("+966 54 648 1962"), "966546481962");
  assert.equal(metaTo("183137590054999999"), "");     // 18 digits: a LID, not a phone
  assert.equal(metaTo("12"), "");
  assert.equal(metaTo(null), "");
});

test("a template message carries the name, language, header image and body variables in order", () => {
  const p = templatePayload({ to: "8801866064500", name: "wecon_mela", lang: "bn", body: ["Rahim", "4-8 Nov"], headerImage: "https://x/y.png" });
  assert.equal(p.messaging_product, "whatsapp");
  assert.equal(p.type, "template");
  assert.deepEqual(p.template.language, { code: "bn" });
  assert.deepEqual(p.template.components[0], { type: "header", parameters: [{ type: "image", image: { link: "https://x/y.png" } }] });
  assert.deepEqual(p.template.components[1].parameters.map((x: any) => x.text), ["Rahim", "4-8 Nov"]);
  // no variables, no header: no components at all (a template with fixed text)
  assert.equal("components" in templatePayload({ to: "8801", name: "hello", lang: "en" }).template, false);
  // a URL button's variable and a quick-reply payload
  const b = templatePayload({ to: "8801", name: "n", lang: "bn", buttons: [{ index: 0, sub: "url", value: "abc" }, { index: 1, sub: "quick_reply", value: "STOP" }] }).template.components;
  assert.deepEqual(b[0], { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc" }] });
  assert.deepEqual(b[1].parameters, [{ type: "payload", payload: "STOP" }]);
});

test("free text payload", () => {
  const p = textPayload("8801866064500", "hello");
  assert.deepEqual(p.text, { body: "hello", preview_url: false });
  assert.equal(p.type, "text");
});

test("Meta's answers fall into the few kinds that need different action", () => {
  assert.deepEqual(metaResult(200, { messages: [{ id: "wamid.X" }] }), { ok: true, kind: "ok", wamid: "wamid.X" });
  const err = (code: number, message = "m") => metaResult(400, { error: { code, message } });
  assert.equal(err(190).kind, "token");
  assert.equal(err(131047).kind, "window");        // free text outside 24 h: send a template
  assert.equal(err(131026).kind, "not_whatsapp");
  assert.equal(err(132001).kind, "template");      // template missing or paused
  assert.equal(err(132000).kind, "template");      // parameter count mismatch
  assert.equal(err(130429).kind, "rate");
  assert.equal(err(131049).kind, "quality");       // Meta chose not to deliver a marketing message
  assert.equal(err(131042).kind, "payment");
  assert.equal(err(999999).kind, "other");
  assert.equal(metaResult(401, {}).kind, "token");
  assert.equal(metaResult(429, null).kind, "rate");
  // the token never appears in a message
  assert.equal(metaResult(400, { error: { code: 190, message: "bad token SECRET123 here" } }, "SECRET123").message, "bad token [redacted] here");
  // error_data.code wins over the outer code, and a 200 with no message id is not a success
  assert.equal(metaResult(400, { error: { code: 100, error_data: { code: 132001 } } }).kind, "template");
  assert.equal(metaResult(200, { messages: [] }).ok, false);
});
