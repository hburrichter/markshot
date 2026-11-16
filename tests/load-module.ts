import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

// Keep host APIs replaceable without launching a screenshot tool or contacting OpenAI.
export function loadModule<T>(
  path: string,
  modules: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
): T {
  const filename = resolve(path);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
  runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (name: string) => (Object.hasOwn(modules, name) ? modules[name] : localRequire(name)),
      Buffer,
      fetch,
      AbortController,
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  return module.exports as T;
}
