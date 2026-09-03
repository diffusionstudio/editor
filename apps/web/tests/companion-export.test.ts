import assert from "node:assert/strict";
import test from "node:test";

import { COMPANION_EXPORT_DISABLED_MESSAGE, runExportAction } from "../src/lib/companion-export.ts";

for (const action of ["scene", "frame"] as const) {
  test(`companion ${action} export rejects before its side-effect callback`, async () => {
    let entered = false;
    await assert.rejects(
      runExportAction(action, async () => {
        entered = true;
        return "unexpected";
      }, true),
      (error: Error) => error.message === COMPANION_EXPORT_DISABLED_MESSAGE,
    );
    assert.equal(entered, false);
  });
}

test("ordinary desktop export still executes the existing action body", async () => {
  let entered = 0;
  const result = await runExportAction("scene", async () => {
    entered++;
    return "desktop-result";
  }, false);
  assert.equal(result, "desktop-result");
  assert.equal(entered, 1);
});
