import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(resolvePath(process.cwd(), `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});