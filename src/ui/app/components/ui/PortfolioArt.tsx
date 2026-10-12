import {
  isNativeCardShare,
  nativeSharePng,
  nativeRemixOrigin,
} from "../../lib/art/native-share.js";
import { remixLink } from "../../lib/art/remix-link.js";
import { useEffect, useMemo, useState } from "react";
import { assetSpec } from "../../lib/solana/assets.js";
import {
  cardAssets,
  cardFamily,
  cardFilename,
  portfolioCardSvg,
  portfolioGeometry,
  renderCardPng,
  svgDataUrl,
  type PortfolioCardInput,
} from "../../lib/art/portfolio-card.js";
import { Button } from "./Button.js";
import { Sheet } from "./Sheet.js";

export function cardInput(
  id: string,
  name: string,
  targets: Record<string, number>,
  draft = false,
): PortfolioCardInput {
  return {
    id,
    name,
    draft,
    assets: Object.entries(targets).map(([id, weight]) => ({
      id,
      weight,
      symbol: assetSpec(id).symbol,
      color: assetSpec(id).color,
    })),
  };
}
export function PortfolioArt({
  input,
  compact = false,
}: {
  input: PortfolioCardInput;
  compact?: boolean;
}) {
  const src = svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 760"><rect width="800" height="760" fill="#efece6"/>${portfolioGeometry(input)}</svg>`,
  );
  return (
    <img
      src={src}
      alt={`${input.name} ${cardFamily(input).toLowerCase()} artwork, based on its target allocation`}
      className={`w-full rounded-lg border border-hairline bg-pulp ${compact ? "h-[170px]" : "h-[240px]"} object-contain`}
    />
  );
}
export function PortfolioShare({ input }: { input: PortfolioCardInput }) {
  const [open, setOpen] = useState(false);
  const [remix, setRemix] = useState(0);
  const [ready, setReady] = useState<{ key: string; file: File } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const composed = useMemo(
    () => ({ ...input, remix }),
    [JSON.stringify(input), remix],
  );
  const key = JSON.stringify(composed);
  const file = ready?.key === key ? ready.file : null;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setMessage("");
    renderCardPng(composed)
      .then((blob) => {
        if (!cancelled)
          setReady({
            key,
            file: new File([blob], cardFilename(composed), {
              type: "image/png",
            }),
          });
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not create the PNG.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [open, key]);
  const origin = isNativeCardShare() ? nativeRemixOrigin() : location.origin;
  const link = origin ? remixLink(composed, origin) : "";
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setMessage("PNG downloaded. Share it wherever you like.");
  }
  async function share() {
    if (!file) return;
    setError("");
    setMessage("");
    // File is prepared before the gesture, preserving the browser's transient share activation.
    if (isNativeCardShare()) {
      try {
        await nativeSharePng(file, `${input.name} · Coloyond`, link);
        setMessage("PNG ready in the Android share sheet.");
      } catch {
        setError("Sharing was cancelled or unavailable. Try again when ready.");
      }
      return;
    }
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
      download();
      return;
    }
    try {
      await navigator.share({
        files: [file],
        title: `${input.name} · Coloyond`,
        text: `Your portfolio as one picture. Remix this mix: ${link}`,
      });
      setMessage("Card shared.");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError("Sharing could not finish. Download the PNG below instead.");
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage(
        "Remix link copied. It opens an unsigned draft of this allocation.",
      );
    } catch {
      setError(
        "Clipboard unavailable. You can still download or share the PNG.",
      );
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        full
        disabled={!cardAssets(input).length}
        onClick={() => setOpen(true)}
      >
        Share portfolio card ↗
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        micro="Card PNG share · local render"
        title="Your mix, as one picture."
        footer={
          <div className="space-y-2">
            <Button
              full
              variant="primary"
              disabled={!file}
              onClick={() => void share()}
            >
              {file ? "Share PNG ↗" : "Rendering PNG…"}
            </Button>
            <Button
              full
              disabled={!file}
              onClick={() => (isNativeCardShare() ? void share() : download())}
            >
              {isNativeCardShare() ? "Save / share PNG" : "Download PNG"}
            </Button>
            <Button full disabled={!link} onClick={() => void copyLink()}>
              Copy remix link
            </Button>
          </div>
        }
      >
        <img
          src={svgDataUrl(portfolioCardSvg(composed))}
          alt={`${input.name} shareable portfolio card preview`}
          className="mx-auto w-full max-w-[280px] rounded-lg border border-hairline"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-iron">
            {cardFamily(composed)} · Remix {remix}
          </span>
          <Button onClick={() => setRemix((n) => n + 1)}>Remix artwork</Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-iron">
          1200 × 1500 PNG. Your target mix, without wallet addresses or balances.
          Remix changes the artwork, never your vault.
        </p>
        {!link ? (
          <p className="mt-2 text-[11px] text-iron">
            Remix links are available from the web app.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="mt-3 text-[12px] text-iron">
            {message}
          </p>
        ) : null}
      </Sheet>
    </>
  );
}
