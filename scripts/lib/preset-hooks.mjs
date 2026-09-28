// Node module hooks (registered by preset.mjs): when the FriendSDK's build script imports `esbuild`, it gets a thin
// wrapper whose context()/build() add the preset's `define` to the SDK's own options. Nothing else is touched.
let define = {};
export async function initialize(data) { define = data?.define ?? {}; }

const TAG = "pk-preset-esbuild";
export async function resolve(specifier, context, next) {
  if (specifier === "esbuild" && context.parentURL?.includes("/@rarefriends/friendsdk/")) {
    const real = await next(specifier, context);
    return { url: `${real.url}?${TAG}`, format: "module", shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith(`?${TAG}`)) return next(url, context);
  const real = JSON.stringify(url.slice(0, -TAG.length - 1)), extra = JSON.stringify(define);
  return {
    format: "module", shortCircuit: true,
    source: `import * as real from ${real};
export * from ${real};
const withPreset = options => ({ ...options, define: { ...(options?.define ?? {}), ...${extra} } });
export const context = options => real.context(withPreset(options));
export const build = options => real.build(withPreset(options));
export default { ...real, context, build };`,
  };
}
