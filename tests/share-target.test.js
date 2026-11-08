import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("share target redirects use absolute same-origin URLs", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const context = {
    URL,
    Response,
    console,
    importScripts() {},
    firebase: {
      initializeApp() {},
      messaging: () => ({ onBackgroundMessage() {} })
    },
    self: {
      location: { origin: "https://moonledger-2b6fb.web.app" },
      addEventListener() {}
    }
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });

  const response = context.redirectTo("/?sharedPayload=receipt-123");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://moonledger-2b6fb.web.app/?sharedPayload=receipt-123");
});
