import { test } from "node:test";
import assert from "node:assert/strict";
import { normPhone, samePhone } from "./phone.ts";

test("BD forms agree", () => {
  for (const f of ["01711000001", "+880 1711-000001", "8801711000001", "008801711000001", "1711000001"]) assert.equal(normPhone(f), "8801711000001", f);
  assert.ok(samePhone("01711000001", "+8801711000001"));
});
test("too short or empty is no identity", () => {
  assert.equal(normPhone("12345"), ""); assert.equal(normPhone(null), "");
  assert.equal(samePhone("", ""), false);
});
test("UAE number does not collide with BD sharing the last 10 digits", () => {
  assert.equal(normPhone("971501234567"), "971501234567");
  assert.equal(samePhone("971501234567", "8801501234567"), false);
});
