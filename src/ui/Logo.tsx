import { useState } from "react";

export function Logo({
  src,
  fallback,
  size = 20,
}: {
  src: string | null | undefined;
  fallback: string;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span
        className="logo-letter"
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.45) }}
      >
        {fallback.charAt(0)}
      </span>
    );
  }
  return (
    <img
      className="logo-img"
      src={src}
      alt={fallback}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}