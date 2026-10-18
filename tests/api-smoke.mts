import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
process.env.JWT_SECRET = randomBytes(48).toString("hex");
process.env.LOG_LEVEL = "silent";
const { default: handler } = await import("../netlify/functions/api.mts");
const { signToken } = await import("../artifacts/api-server/src/middlewares/auth.ts");
const cases = [
  ["/api/healthz", 200],
  ["/.netlify/functions/api/healthz", 200],
  ["/api/payd/account", 401],
  ["/api/settings/credentials", 401],
  ["/api/test/credentials", 403],
] as const;
for (const [path, status] of cases) {
  const response = await handler(new Request(`https://example.test${path}`), {});
  assert.equal(response.status, status, path);
  assert.equal(response.headers.get("cache-control"), "no-store");
}
const token = signToken({ userId: 1, email: "review@example.test", name: "Review" });
const denied = await handler(new Request("https://example.test/api/test/credentials", {
  headers: { cookie: `payd_session=${token}` },
}), {});
assert.equal(denied.status, 403);
const team = await handler(new Request("https://example.test/api/test/status"), {
  user: { id: "review-team", email: "review@example.test" },
});
assert.equal(team.status, 200);
const register = await handler(new Request("https://example.test/api/auth/register", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
}), {});
assert.equal(register.status, 400);
const logout = await handler(new Request("https://example.test/api/auth/logout", { method: "POST" }), {});
assert.equal(logout.status, 200);
assert.match(logout.headers.get("set-cookie") ?? "", /payd_session=/);
for (const path of ["/api/payd/payout", "/api/payd/p2p"]) {
  const response = await handler(new Request(`https://example.test${path}`, { method: "POST" }), {});
  assert.equal(response.status, 401);
}
const callback = await handler(new Request("https://example.test/api/webhook/payd", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
}), {});
assert.equal(callback.status, 400);
console.log("12 API smoke checks passed; no live transactions submitted.");
