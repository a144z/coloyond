import { ColoyondApp } from "./ColoyondApp.js";
import { AuctionWorkbench } from "./rebalancing/AuctionWorkbench.js";

export function App() {
  if (window.location.pathname.replace(/\/$/, "") === "/rebalancing-lab") {
    return <AuctionWorkbench />;
  }
  return <ColoyondApp />;
}
