import { useId } from "react";

type ReferenceArtProps = {
  variant?: "planes" | "orbit" | "slabs";
  className?: string;
  title?: string;
};

const descriptions = {
  planes: "Illustrative folded planes with cobalt, coral, yellow, and violet beams",
  orbit: "Illustrative interrupted black ring with saturated colored planes",
  slabs: "Illustrative offset slabs with an opening between blue and yellow forms",
};

export function ReferenceArt({ variant = "planes", className, title }: ReferenceArtProps) {
  const instanceId = useId().replace(/:/g, "");
  const warm = `warm-${instanceId}`;
  const cool = `cool-${instanceId}`;
  const ink = `ink-${instanceId}`;
  const grain = `grain-${instanceId}`;

  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 360"
      role="img"
      aria-label={title ?? descriptions[variant]}
      width="100%"
      height="100%"
    >
      <defs>
        <linearGradient id={warm} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ff513b" />
          <stop offset="1" stopColor="#ffd523" />
        </linearGradient>
        <linearGradient id={cool} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#1249ed" />
          <stop offset="1" stopColor="#8d25d9" />
        </linearGradient>
        <linearGradient id={ink} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#c3bdad" />
          <stop offset="1" stopColor="#171715" />
        </linearGradient>
        <filter id={grain} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="17" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".10" />
          </feComponentTransfer>
        </filter>
      </defs>

      {variant === "planes" && (
        <g transform="rotate(0 180 170)">
          <path d="M48 120 180 48 250 88 119 162Z" fill={`url(#${ink})`} />
          <path d="M48 120 119 162 119 250 48 209Z" fill="#999487" />
          <path d="M119 162 180 129 180 216 119 250Z" fill="#171715" />
          <path d="M180 48 250 88 250 165 180 129Z" fill={`url(#${warm})`} />
          <path d="M180 129 250 165 180 216Z" fill={`url(#${cool})`} />
          <path d="M157 207 360 115 360 172Z" fill="#ff513b" />
          <path d="M157 207 360 172 360 213Z" fill="#1249ed" />
          <path d="M157 207 360 213 360 262Z" fill="#ffd523" />
          <path d="M157 207 360 262 360 318Z" fill="#8d25d9" />
          <path d="M119 162 257 242 257 298 119 218Z" fill={`url(#${ink})`} />
          <path d="M48 209 119 218 257 298 185 315Z" fill="#171715" />
        </g>
      )}

      {variant === "orbit" && (
        <g transform="rotate(-16 180 180)">
          <circle
            cx="176"
            cy="176"
            r="98"
            fill="none"
            stroke="#171715"
            strokeWidth="39"
            strokeDasharray="440 176"
            transform="rotate(34 176 176)"
          />
          <path d="M164 52 259 84 236 153 142 120Z" fill={`url(#${cool})`} />
          <path d="M150 167 340 98 324 151 185 188Z" fill="#ffd523" />
          <path d="M164 201 336 194 306 238 165 222Z" fill="#ff513b" />
          <path d="M151 235 270 283 234 312 139 255Z" fill="#8d25d9" />
          <circle cx="176" cy="176" r="46" fill="#f7f2e5" />
        </g>
      )}

      {variant === "slabs" && (
        <g transform="rotate(0 180 180)">
          <path d="M43 85 158 43 158 245 43 286Z" fill="#171715" />
          <path d="M43 85 102 113 216 72 158 43Z" fill={`url(#${ink})`} />
          <path d="M102 113 216 72 216 175 102 216Z" fill={`url(#${cool})`} />
          <path d="M178 212 300 169 300 261 178 307Z" fill={`url(#${warm})`} />
          <path d="M178 212 208 227 329 184 300 169Z" fill="#ffd523" />
          <path d="M300 169 329 184 329 277 300 261Z" fill="#171715" />
          <path d="M32 315 144 275 157 283 47 324Z" fill="#8d25d9" />
        </g>
      )}

      <rect width="360" height="360" filter={`url(#${grain})`} opacity=".7" />
    </svg>
  );
}

export default ReferenceArt;
