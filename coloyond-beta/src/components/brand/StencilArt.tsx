/**
 * Equilibrium Construct 0819 — the silkscreen lacquerwork from the flash-ui
 * reference, ported to the app tokens. Sliced discs, interlocking
 * counterweight, razor fulcrum: the brand's statement on balance.
 */
export function StencilArt({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 380 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Silkscreen lacquerwork showing sliced discs and interlocking cantilevers expressing isolation and balance"
      className={className}
    >
      {/* paper ground */}
      <rect width="380" height="340" fill="var(--color-pulp-shade)" />

      {/* matte slate slab */}
      <rect x="30" y="50" width="160" height="220" fill="var(--color-iron)" />

      {/* sliced disc: petrol cantilever */}
      <path d="M 120 70 A 90 90 0 0 1 290 200 L 120 200 Z" fill="var(--color-petrol)" />

      {/* interlocking disc: brass counterweight */}
      <circle cx="250" cy="180" r="64" fill="var(--color-brass)" />

      {/* sliced void, inverted cutout */}
      <path d="M 250 180 L 314 180 A 64 64 0 0 1 250 244 Z" fill="var(--color-pulp-shade)" />

      {/* fulcrum blade: razor ink wedge */}
      <polygon points="120,290 270,290 195,210" fill="var(--color-ink)" />

      {/* thin hard-edge calipers */}
      <line x1="20" y1="290" x2="360" y2="290" stroke="var(--color-ink)" strokeWidth="2" />
      <line x1="30" y1="30" x2="30" y2="310" stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="350" y1="30" x2="350" y2="310" stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="3 3" />

      {/* numeric stencil stamp */}
      <text x="44" y="80" fontFamily="var(--font-display)" fontSize="28" fontWeight="700" fill="var(--color-ledger)">
        0819
      </text>
      <text x="44" y="100" fontFamily="var(--font-mono)" fontSize="9" letterSpacing="2" fill="var(--color-ledger)">
        NON-CUSTODIAL
      </text>
    </svg>
  );
}
