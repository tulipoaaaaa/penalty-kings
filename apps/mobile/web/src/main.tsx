import { createRoot } from "react-dom/client";
import { snapshotPrice } from "../../../../games/penalty-kings/game/price.ts";
import { App } from "./app.tsx";
import { installAudioUnlock } from "./pwa.ts";
import { SimEconomy, safeStorage } from "./wallet.ts";
import "./style.css";

// The simulated economy: persisted in localStorage when it works (in-memory otherwise), priced with the game's
// recorded on-chain RF snapshot. Its "offline" is only ever the injected failure: the app itself works offline.
const economy = new SimEconomy({
  storage: safeStorage(() => window.localStorage),
  usdPerRf: () => snapshotPrice().usdPerRf,
  delayMs: 650,
  isOnline: () => true,
});
installAudioUnlock();
createRoot(document.getElementById("root")!).render(<App economy={economy} />);
