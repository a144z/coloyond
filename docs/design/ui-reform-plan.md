# Reference-rooted UI reform

## Source of truth

`docs/design/coloyond-strategy-cards.html` defines the visual language. Keep its standalone `/reference/index.html` page unchanged. Reuse its paper (`#f1ecdd`), ink (`#171715`), rule (`#d9d3c3`), blue, violet, yellow, coral, Arial display type, monospace micro labels, geometric artwork, quiet facts, and restrained controls. Preserve the distinction between interpretation (art and caption) and financial facts.

## Product map

1. **Portfolio:** show managed strategy identity, separate NAV / market / indicative quote, target versus illustrative actual weights, drift, and entry points to route prep, yield, and progress.
2. **Shield:** keep chain, token, amount, slippage, route lookup, loading/error states, route comparison, and hook information. Make sample versus fetched routes explicit. Mode is a presentation preference until a provider can honor it.
3. **Yield:** show featured pool and other pools with rates, lock terms, and status. No false staking action: the browser prototype has no wallet transaction flow.
4. **Ecosystem:** explain the dependency order from managed share and exit liquidity through routing, fees, and optional engagement.
5. **Game:** preserve quest toggles, XP/streak display, and optional boost simulation, while distinguishing local demo progress from financial yield.

## Design decisions

- One editorial canvas and one numbered navigation system across all five views.
- Large but spare headings; geometric art carries the expressive weight. Dense financial controls stay in structured panels with thin rules and generous spacing.
- Color marks composition and interaction, never risk or performance. Status is always written in text.
- Page sections scale from two-column desktop layouts to one-column mobile layouts. Focus indicators, 44px targets, and reduced-motion support remain available.

## Completion criteria

- All five views use the reference-rooted system at desktop and mobile widths, with no old dark/neon styling loaded.
- Existing working inputs, route fetch, navigation, quest toggles, and boost simulation remain usable.
- Demo figures and non-executable actions are labeled accurately.
- `/reference/index.html` is unchanged and reachable from the application.
- Typecheck, production build, and browser checks pass.
