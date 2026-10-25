import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { runBrowserFetch } from "../../dist/tools/browser-fetch.js";

test("browser fetch does not follow a redirect outside the allowed URL prefix", async (t) => {
  let forbiddenRequests = 0;
  const forbidden = createServer((_req, res) => { forbiddenRequests++; res.end("forbidden canary"); });
  await new Promise(resolve => forbidden.listen(0, "127.0.0.1", resolve));
  const redirect = createServer((_req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${forbidden.address().port}/private` }); res.end(); });
  await new Promise(resolve => redirect.listen(0, "127.0.0.1", resolve));
  const patch = { QLING_GUARD_ENABLED: "true", QLING_GUARD_NETWORK_MODE: "guarded", QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "false", QLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify([`http://127.0.0.1:${redirect.address().port}/`]) };
  const previous = Object.fromEntries(Object.keys(patch).map(k => [k, process.env[k]]));
  Object.assign(process.env, patch);
  const launch = chromium.launch.bind(chromium);
  if (process.platform === "win32") t.mock.method(chromium, "launch", options => launch({ ...options, channel: "msedge" }));
  try {
    const result = await runBrowserFetch({ url: `http://127.0.0.1:${redirect.address().port}/start` });
    assert.equal(forbiddenRequests, 0);
    assert.equal(result.is_error, true);
  } finally {
    for (const key of Object.keys(patch)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await Promise.all([new Promise(resolve => forbidden.close(resolve)), new Promise(resolve => redirect.close(resolve))]);
  }
});

test("allowed browser redirects retain their final URL for relative scripts", async (t) => {
  let childRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/start") { res.writeHead(302, { Location: "/docs/index.html" }); res.end(); }
    else if (req.url === "/docs/app.js") { res.setHeader("content-type", "text/javascript"); res.end("if(window.Worker) new Worker('/worker.js');window.open('/popup');document.body.insertAdjacentHTML('beforeend','<main id=ready>42</main>');"); }
    else if (req.url === "/docs/index.html") { res.setHeader("content-type", "text/html"); res.end('<body>initial<iframe src="/iframe"></iframe><script src="app.js"></script>'); }
    else if (["/worker.js", "/popup", "/iframe"].includes(req.url)) { childRequests++; res.end("untrusted child"); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const patch = { QLING_GUARD_ENABLED: "true", QLING_GUARD_NETWORK_MODE: "guarded", QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "false", QLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify([`http://127.0.0.1:${server.address().port}/`]) };
  const previous = Object.fromEntries(Object.keys(patch).map(k => [k, process.env[k]]));
  Object.assign(process.env, patch);
  const launch = chromium.launch.bind(chromium);
  if (process.platform === "win32") t.mock.method(chromium, "launch", options => launch({ ...options, channel: "msedge" }));
  try {
    const result = await runBrowserFetch({ url: `http://127.0.0.1:${server.address().port}/start`, wait_for: "#ready" });
    assert.notEqual(result.is_error, true);
    assert.match(result.output, /42/);
    assert.equal(childRequests, 0);
  } finally {
    for (const key of Object.keys(patch)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await new Promise(resolve => server.close(resolve));
  }
});
