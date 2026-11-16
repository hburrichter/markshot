import { mkdtemp, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureError } from "./errors";

const CAPTURE_FAILURE = "Screen capture failed. Check Screen Recording permission for TinyCast or Raycast";

export async function withCapturedImage<T>(useImage: (path: string) => Promise<T>): Promise<T | null> {
  const directory = await mkdtemp(join(tmpdir(), "capture-markdown-"));
  const path = join(directory, "capture.png");

  try {
    const result = await new Promise<{ code: number | null; hasError: boolean }>((resolve, reject) => {
      const child = spawn("/usr/sbin/screencapture", ["-i", "-x", "-t", "png", path], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let hasError = false;
      child.stderr?.on("data", (chunk: Buffer) => {
        hasError ||= chunk.toString().trim().length > 0;
      });
      child.once("error", () => reject(new CaptureError("Unable to start macOS screen capture")));
      child.once("close", (code) => resolve({ code, hasError }));
    });

    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (missing && !result.hasError && (result.code === 0 || result.code === 1)) return null;
      throw new CaptureError(CAPTURE_FAILURE);
    }
    if (result.code !== 0 || result.hasError || size === 0) throw new CaptureError(CAPTURE_FAILURE);
    return await useImage(path);
  } finally {
    // Codex reads the PNG by path; keep it only until the provider finishes, on every exit path.
    await rm(directory, { recursive: true, force: true });
  }
}
