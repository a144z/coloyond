import { ColoyondApp } from "./ColoyondApp.js";
import { AuctionWorkbench } from "./rebalancing/AuctionWorkbench.js";
import { SymmetryDevnetPage } from "./portfolio/SymmetryDesk.js";

export function App() {
  if (window.location.pathname.replace(/\/$/, "") === "/rebalancing-lab") {
    return <AuctionWorkbench />;
  }
  if (window.location.pathname.replace(/\/$/, "") === "/symmetry-devnet") {
    return <SymmetryDevnetPage />;
  }
  return <ColoyondApp />;
}
