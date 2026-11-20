import { strict as assert } from "node:assert";
import { test } from "node:test";
import pages from "./pages/public/_worker.js";
import worker from "./worker/index.js";

const publicOrigin = "https://ledgerharbour.pages.dev";

test("passes a signed-in request to the private origin and keeps the response private", async () => {
  const request = new Request(publicOrigin + "/api/example?format=json", {
    method: "POST",
    body: "fixture body",
    headers: {
      "CF-Connecting-IP": "192.0.2.10",
      "x-ledgerharbour-client-ip": "192.0.2.11",
      "x-forwarded-host": "untrusted.example",
      Cookie: "test-session=fixture",
    },
  });
  const response = await pages.fetch(request, { ORIGIN: {
    fetch: (forwarded) => worker.fetch(forwarded, { PRIVATE_APP: {
      async fetch(upstream, options) {
        assert.equal(upstream.url, "http://ledgerharbour.pages.dev/api/example?format=json");
        assert.equal(upstream.method, "POST");
        assert.equal(await upstream.text(), "fixture body");
        assert.equal(upstream.headers.get("Cookie"), "test-session=fixture");
        assert.equal(upstream.headers.get("x-ledgerharbour-client-ip"), "192.0.2.10");
        assert.equal(upstream.headers.get("x-forwarded-host"), "ledgerharbour.pages.dev");
        assert.equal(upstream.headers.get("x-forwarded-proto"), "https");
        assert.equal(options.redirect, "manual");
        const headers = new Headers({ Location: "/login", "Cache-Control": "public" });
        headers.append("Set-Cookie", "first=fixture; Secure");
        headers.append("Set-Cookie", "second=fixture; Secure");
        return new Response(null, { status: 303, headers });
      },
    } }),
  } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/login");
  assert.deepEqual(response.headers.getSetCookie(), ["first=fixture; Secure", "second=fixture; Secure"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("rejects aliases and strips a claimed address when the edge sends none", async () => {
  const alias = await pages.fetch(new Request("https://preview.ledgerharbour.pages.dev/"), {});
  assert.equal(alias.status, 404);
  const request = new Request(publicOrigin, { headers: { "x-ledgerharbour-client-ip": "192.0.2.11" } });
  const response = await pages.fetch(request, { ORIGIN: {
    fetch(forwarded) {
      assert.equal(forwarded.headers.has("x-ledgerharbour-client-ip"), false);
      return Promise.resolve(new Response("ok"));
    },
  } });
  assert.equal(await response.text(), "ok");
});

test("returns a private generic failure when the origin is unavailable", async () => {
  const response = await pages.fetch(new Request(publicOrigin), { ORIGIN: {
    async fetch() { throw new Error("private fixture details"); },
  } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "Service unavailable");
});
