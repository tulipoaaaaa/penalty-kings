// Phone layouts (R6-B7): a portrait frame shows "Turn your phone sideways" first. Browser tests that play at a
// portrait size (the SDK harness default is 360 × 800) choose "Play in portrait anyway" before anything else.
/** Dismisses the rotate card if it is up (portrait frames only); returns whether it was shown. */
export async function playInPortraitIfAsked(game) {
  const button = game.getByTestId("portrait-anyway");
  await game.getByTestId("rotate").waitFor({ state: "attached", timeout: 10_000 });
  if (!(await button.isVisible())) return false;
  await button.click();
  await game.getByTestId("rotate").waitFor({ state: "hidden" });
  return true;
}
