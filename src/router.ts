import { QuoteProvider } from "./providers.js";
import { AtomicLevel, Route, RouteStep, SwapRequest } from "./types.js";

export interface RankedRoutes {
  bestPrice: Route | null;
  fastest: Route | null;
  mostAtomic: Route | null;
  all: Route[];
}

export class RouteFinder {
  constructor(private readonly providers: QuoteProvider[]) {}

  async find(request: SwapRequest): Promise<Route[]> {
    const settled = await Promise.allSettled(this.providers.map((p) => p.quote(request)));
    const routes: Route[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") routes.push(...s.value.routes);
    }
    return routes;
  }

  rank(routes: Route[]): RankedRoutes {
    const byPrice = [...routes].sort((a, b) => b.outputAmountNum - a.outputAmountNum);
    const byTime = [...routes].sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds);
    const atomicWeight: Record<AtomicLevel, number> = { full: 0, partial: 1, intent: 2 };
    const byAtomic = [...routes].sort(
      (a, b) => atomicWeight[a.atomicLevel] - atomicWeight[b.atomicLevel] || a.totalTimeSeconds - b.totalTimeSeconds,
    );
    return {
      bestPrice: byPrice[0] ?? null,
      fastest: byTime[0] ?? null,
      mostAtomic: byAtomic[0] ?? null,
      all: routes,
    };
  }
}

export function stepSummary(step: RouteStep): string {
  const lane = step.kind === "bridge" ? `${step.fromChainId}->${step.toChainId}` : `chain ${step.fromChainId}`;
  return `${step.protocol} @ ${lane}: ${step.fromSymbol} -> ${step.toSymbol}`;
}
