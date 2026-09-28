// Node module hooks (registered by preset.mjs for the early access preset): when the FriendSDK's build script imports
// `esbuild`, it gets a thin wrapper whose context()/build() add the early access plugin (ea-regions.mjs) to the SDK's
// own options. Nothing else is touched, and nothing is registered for the full preset.
let plugin = null;
export async function initialize(data) { plugin = data?.plugin ?? null; }

const TAG = "pk-preset-esbuild";
export async function resolve(specifier, context, next) {
  if (plugin && specifier === "esbuild" && context.parentURL?.includes("/@rarefriends/friendsdk/")) {
    const real = await next(specifier, context);
    return { url: `${real.url}?${TAG}`, format: "module", shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith(`?${TAG}`)) return next(url, context);
  const real = JSON.stringify(url.slice(0, -TAG.length - 1));
  return {
    format: "module", shortCircuit: true,
    source: `import * as real from ${real};
import { earlyAccessPlugin } from ${JSON.stringify(plugin)};
export * from ${real};
const withPreset = options => ({ ...options, plugins: [earlyAccessPlugin(), ...(options?.plugins ?? [])] });
export const context = options => real.context(withPreset(options));
export const build = options => real.build(withPreset(options));
export default { ...real, context, build };`,
  };
}
