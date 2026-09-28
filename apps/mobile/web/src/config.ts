/** Build-time configuration, injected by scripts/build-test-app.mjs (esbuild define). No secrets: PRIVY_APP_ID is a public id. */
export type TestAppConfig = {
  wallet: "dev" | "privy" | "injected";
  privyAppId: string | null;
  version: string;
  appId: string;
  appName: string;
  /** 64 recorded canonical frames of the SDK fixture Friend #7730 (hex), for its art on the "Get a Friend" screen. */
  fixtureFrames: string[];
};
declare const __PK_TEST_CONFIG__: TestAppConfig;
export const CONFIG: TestAppConfig = __PK_TEST_CONFIG__;
