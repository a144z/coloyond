import { ColoyondApp } from "./ColoyondApp.js";
import { AuctionWorkbench } from "./rebalancing/AuctionWorkbench.js";
import { SymmetryDevnetPage } from "./portfolio/SymmetryDesk.js";
import { DevnetReadPage } from "./etf/DevnetReadPage.js";

export function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/etf-devnet") {
    return <DevnetReadPage />;
  }
  if (path === "/rebalancing-lab") {
    return <AuctionWorkbench />;
  }
  if (path === "/symmetry-devnet") {
    return <SymmetryDevnetPage />;
  }
  return <ColoyondApp />;
}
