import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "node:test";
import { loadModule } from "./load-module";

type CaptureModule = { withCapturedImage<T>(callback: (path: string) => Promise<T>): Promise<T | null> };

for (const scenario of ["success", "cancel", "permission", "partial", "empty", "spawn", "signal"] as const) {
  test(`capture ${scenario}: private screenshot directory is removed`, async () => {
    let capturePath = "";
    const capture = loadModule<CaptureModule>("src/lib/capture.ts", {
      "node:child_process": {
        spawn: (command: string, args: string[]) => {
          assert.equal(command, "/usr/sbin/screencapture");
          assert.deepEqual(Array.from(args.slice(0, 4)), ["-i", "-x", "-t", "png"]);
          capturePath = args[args.length - 1];
          const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
          queueMicrotask(async () => {
            if (scenario === "spawn") {
              child.emit("error", new Error("fake spawn failure"));
              return;
            }
            if (scenario === "success" || scenario === "partial" || scenario === "empty") {
              await writeFile(capturePath, scenario === "empty" ? "" : "fake image");
            }
            if (scenario === "permission") child.stderr.emit("data", Buffer.from("cannot capture display"));
            child.emit("close", scenario === "signal" ? null : scenario === "success" ? 0 : 1);
          });
          return child;
        },
      },
    });
    if (scenario === "success") {
      assert.equal(
        await capture.withCapturedImage(async (path) => {
          assert.equal((await readFile(path)).toString(), "fake image");
          return "transcription";
        }),
        "transcription",
      );
    } else if (scenario === "cancel") {
      assert.equal(
        await capture.withCapturedImage(async () => {
          throw new Error("Canceled capture must not call the provider");
        }),
        null,
      );
    } else {
      await assert.rejects(
        capture.withCapturedImage(async () => {
          throw new Error("Canceled capture must not call the provider");
        }),
        /capture/i,
      );
    }
    assert.ok(capturePath);
    await assert.rejects(access(dirname(capturePath)), { code: "ENOENT" });
  });
}

test("capture removes its private directory when the provider fails", async () => {
  let path = "";
  const capture = loadModule<CaptureModule>("src/lib/capture.ts", {
    "node:child_process": {
      spawn: (_command: string, args: string[]) => {
        path = args.at(-1)!;
        const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
        queueMicrotask(async () => {
          await writeFile(path, "fake image");
          child.emit("close", 0);
        });
        return child;
      },
    },
  });
  await assert.rejects(
    capture.withCapturedImage(async () => {
      throw new Error("provider failure");
    }),
    /provider failure/,
  );
  await assert.rejects(access(dirname(path)), { code: "ENOENT" });
});
