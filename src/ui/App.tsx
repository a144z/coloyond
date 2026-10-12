import { LandingPage } from "./LandingPage.js";
import { ColoyondApp } from "./ColoyondApp.js";
import { AuctionWorkbench } from "./rebalancing/AuctionWorkbench.js";
import { SymmetryDevnetPage } from "./portfolio/SymmetryDesk.js";
import { DevnetReadPage } from "./etf/DevnetReadPage.js";
import { EtfTransactionsPage } from "./etf/EtfTransactionsPage.js";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/app") {
    return <ColoyondApp />;
  }
  if (path === "/etf-devnet") {
    return <DevnetReadPage />;
  }
  if (path === "/etf-devnet/transactions") {
    return <EtfTransactionsPage />;
  }
  if (path === "/rebalancing-lab") {
    return <AuctionWorkbench />;
  }
  if (path === "/symmetry-devnet") {
    return <SymmetryDevnetPage />;
  }
  return <LandingPage />;
}
