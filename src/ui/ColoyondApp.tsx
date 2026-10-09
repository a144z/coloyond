import { useRef, useState } from "react";
import {
  CAPTIONS,
  EXPRESSION,
  FOOTER_LINK,
  FOOTER_NOTE,
  FOOTNOTES,
  INTRO_COPY,
  INTRO_TITLE,
  NOTICE,
  PREVIEW_LABEL,
  REMIX,
  SCREENS,
  SHARE_DIALOG,
  SHARE_TARGET,
  STATUS_GLYPHS,
  STATUS_TIME,
  STRATEGY,
  STUDY_LABELS,
  STUDY_SHAPES,
  TOP_LINKS,
} from "./product.js";

const INK = "#171715";
const BLUE = "#1249ED";
const YELLOW = "#FFD523";
const VIOLET = "#8D25D9";
const CORAL = "#FF513B";

const UNSAVED_LABEL = "Unsaved expression";

function art(kind: number, suffix: string, remix = false): string {
  const rotation = remix ? 9 : 0;
  const defs = `<defs>
    <linearGradient id="warm-${suffix}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${CORAL}"/><stop offset="1" stop-color="${YELLOW}"/></linearGradient>
    <linearGradient id="cool-${suffix}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${BLUE}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient>
    <linearGradient id="ink-${suffix}" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#C3BDAD"/><stop offset="1" stop-color="${INK}"/></linearGradient>
    <filter id="grain-${suffix}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="17"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".10"/></feComponentTransfer></filter>
  </defs>`;
  let geometry = "";
  if (kind === 0) {
    geometry = `<g transform="rotate(${rotation} 180 170)">
      <path d="M48 120 180 48 250 88 119 162Z" fill="url(#ink-${suffix})"/>
      <path d="M48 120 119 162 119 250 48 209Z" fill="#999487"/>
      <path d="M119 162 180 129 180 216 119 250Z" fill="${INK}"/>
      <path d="M180 48 250 88 250 165 180 129Z" fill="url(#warm-${suffix})"/>
      <path d="M180 129 250 165 180 216Z" fill="url(#cool-${suffix})"/>
      <path d="M157 207 360 115 360 172Z" fill="${CORAL}"/>
      <path d="M157 207 360 172 360 213Z" fill="${BLUE}"/>
      <path d="M157 207 360 213 360 262Z" fill="${YELLOW}"/>
      <path d="M157 207 360 262 360 318Z" fill="${VIOLET}"/>
      <path d="M119 162 257 242 257 298 119 218Z" fill="url(#ink-${suffix})"/>
      <path d="M48 209 119 218 257 298 185 315Z" fill="${INK}"/>
    </g>`;
  } else if (kind === 1) {
    geometry = `<g transform="rotate(${rotation - 16} 180 180)">
      <circle cx="176" cy="176" r="98" fill="none" stroke="${INK}" stroke-width="39" stroke-dasharray="440 176" transform="rotate(34 176 176)"/>
      <path d="M164 52 259 84 236 153 142 120Z" fill="url(#cool-${suffix})"/>
      <path d="M150 167 340 98 324 151 185 188Z" fill="${YELLOW}"/>
      <path d="M164 201 336 194 306 238 165 222Z" fill="${CORAL}"/>
      <path d="M151 235 270 283 234 312 139 255Z" fill="${VIOLET}"/>
      <circle cx="176" cy="176" r="46" fill="#F7F2E5"/>
    </g>`;
  } else {
    geometry = `<g transform="rotate(${rotation} 180 180)">
      <path d="M43 85 158 43 158 245 43 286Z" fill="${INK}"/>
      <path d="M43 85 102 113 216 72 158 43Z" fill="url(#ink-${suffix})"/>
      <path d="M102 113 216 72 216 175 102 216Z" fill="url(#cool-${suffix})"/>
      <path d="M178 212 300 169 300 261 178 307Z" fill="url(#warm-${suffix})"/>
      <path d="M178 212 208 227 329 184 300 169Z" fill="${YELLOW}"/>
      <path d="M300 169 329 184 329 277 300 261Z" fill="${INK}"/>
      <path d="M32 315 144 275 157 283 47 324Z" fill="${VIOLET}"/>
    </g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" role="img" aria-label="${STUDY_SHAPES[kind]}">${defs}${geometry}<rect width="360" height="360" filter="url(#grain-${suffix})" opacity=".7"/></svg>`;
}

interface ShareCardProps {
  study: number;
  caption: string;
  captionVisible: boolean;
  artSuffix: string;
}

function ShareCard({ study, caption, captionVisible, artSuffix }: ShareCardProps) {
  return (
    <div className="share-card">
      <div className="art" dangerouslySetInnerHTML={{ __html: art(study, artSuffix) }} />
      <div className={captionVisible ? "caption" : "caption hidden"}>{caption}</div>
      <div className="card-foot">
        <div className="card-foot-top">
          <span className="id">{EXPRESSION.id}</span>
          <span className="card-brand">coloyond</span>
        </div>
        <div className="card-facts">
          {EXPRESSION.facts[0]}
          <br />
          {EXPRESSION.facts[1]}
        </div>
      </div>
    </div>
  );
}

export function ColoyondApp() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [study, setStudy] = useState(0);
  const [caption, setCaption] = useState(0);
  const [captionVisible, setCaptionVisible] = useState(true);
  const [allocation, setAllocation] = useState(70);
  const [remixVariation, setRemixVariation] = useState(1);
  const [saved, setSaved] = useState({
    study: 0,
    caption: CAPTIONS[0],
    captionVisible: true,
  });
  const [notice, setNotice] = useState("");

  const currentCaption = CAPTIONS[caption];
  const dirty =
    study !== saved.study ||
    currentCaption !== saved.caption ||
    captionVisible !== saved.captionVisible;
  const remixStudy = (REMIX.parentStudy + remixVariation) % 3;

  const nextStudy = () => {
    setStudy((v) => (v + 1) % 3);
    setNotice(NOTICE.study);
  };

  const nextCaption = () => setCaption((v) => (v + 1) % CAPTIONS.length);

  const previewRemix = () => {
    setRemixVariation((v) => (v === 1 ? 2 : 1));
    setNotice(NOTICE.remix);
  };

  const saveExpression = () => {
    setSaved({ study, caption: currentCaption, captionVisible });
    setNotice(NOTICE.saved);
  };

  const share = () => dialogRef.current?.showModal();

  return (
    <>
      <main className="board">
        <div className="intro">
          <div>
            <p className="eyebrow">coloyond / Strategy expressions / Design 02</p>
            <h1>
              {INTRO_TITLE[0]}
              <br />
              {INTRO_TITLE[1]}
            </h1>
          </div>
          <p>
            {INTRO_COPY[0]}
            <br />
            <br />
            {INTRO_COPY[1]}
          </p>
        </div>

        <div className="controls" aria-label="Product preview controls">
          <label>
            Visual study
            <select
              value={study}
              onChange={(e) => setStudy(Number(e.target.value))}
            >
              {STUDY_LABELS.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Caption
            <select
              value={currentCaption}
              onChange={(e) => setCaption(CAPTIONS.indexOf(e.target.value))}
            >
              {CAPTIONS.map((text) => (
                <option key={text} value={text}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={captionVisible}
              onChange={(e) => setCaptionVisible(e.target.checked)}
            />
            Include caption
          </label>
          <span className="preview-label">{PREVIEW_LABEL}</span>
        </div>

        <div className="screens">
          <section aria-label="Select a strategy">
            <p className="screen-label">
              <span>{SCREENS[0][0]}</span> {SCREENS[0][1]}
            </p>
            <div className="phone">
              <div className="status">
                <span>{STATUS_TIME}</span>
                <span aria-hidden="true">{STATUS_GLYPHS}</span>
              </div>
              <header className="topbar">
                <span className="brand">coloyond</span>
                <span className="top-link">{TOP_LINKS.create}</span>
              </header>
              <div className="body">
                <div
                  className="art"
                  dangerouslySetInnerHTML={{ __html: art(study, "create") }}
                />
                <div className="id-row">
                  <span className="id">{STRATEGY.id}</span>
                  <span className="quiet">{STRATEGY.network}</span>
                </div>
                <div className="label">{STRATEGY.label}</div>
                <div className="funding">
                  <span>{STRATEGY.funding.left}</span>
                  <span className="quiet">{STRATEGY.funding.right}</span>
                </div>
                <div className="allocations">
                  {STRATEGY.targets.map((t) => (
                    <div className="allocation" key={t.asset}>
                      <span className="asset">
                        <i className={`dot${t.dotClass ? ` ${t.dotClass}` : ""}`} />
                        {t.asset}
                      </span>
                      <strong>{t.pct}%</strong>
                    </div>
                  ))}
                  <div className="bar">
                    <span style={{ width: `${STRATEGY.bar.bluePct}%` }} />
                    <span />
                  </div>
                </div>
                <details className="details">
                  <summary>{STRATEGY.details.summary}</summary>
                  <p>{STRATEGY.details.body}</p>
                </details>
                <button className="button" onClick={nextStudy}>
                  {STRATEGY.generate}
                </button>
                <p className="micro">
                  {STRATEGY.micro[0]}
                  <br />
                  {STRATEGY.micro[1]}
                </p>
              </div>
            </div>
          </section>

          <section aria-label="Save an expression">
            <p className="screen-label">
              <span>{SCREENS[1][0]}</span> {SCREENS[1][1]}
            </p>
            <div className="phone">
              <div className="status">
                <span>{STATUS_TIME}</span>
                <span aria-hidden="true">{STATUS_GLYPHS}</span>
              </div>
              <header className="topbar">
                <span className="brand">coloyond</span>
                <span className="top-link">{dirty ? UNSAVED_LABEL : SHARE_TARGET}</span>
              </header>
              <div className="body">
                <ShareCard
                  study={study}
                  caption={currentCaption}
                  captionVisible={captionVisible}
                  artSuffix="share"
                />
                <div className="expression-tools">
                  <button className="text-button" onClick={nextStudy}>
                    {EXPRESSION.tools.image}
                  </button>
                  <button className="text-button" onClick={nextCaption}>
                    {EXPRESSION.tools.caption}
                  </button>
                </div>
                <div className="button-row">
                  <button className="button secondary" disabled={!dirty} onClick={saveExpression}>
                    {EXPRESSION.save}
                  </button>
                  <button className="button" disabled={dirty} onClick={share}>
                    {EXPRESSION.share}
                  </button>
                </div>
                <details className="details">
                  <summary>{EXPRESSION.details.summary}</summary>
                  <p>{EXPRESSION.details.body}</p>
                </details>
                <p className="micro">
                  {EXPRESSION.micro[0]}
                  <br />
                  {EXPRESSION.micro[1]}
                </p>
              </div>
            </div>
          </section>

          <section aria-label="Make a remix">
            <p className="screen-label">
              <span>{SCREENS[2][0]}</span> {SCREENS[2][1]}
            </p>
            <div className="phone">
              <div className="status">
                <span>{STATUS_TIME}</span>
                <span aria-hidden="true">{STATUS_GLYPHS}</span>
              </div>
              <header className="topbar">
                <span className="brand">coloyond</span>
                <span className="top-link">{TOP_LINKS.remix}</span>
              </header>
              <div className="body">
                <div className="parent">
                  <div
                    className="art art-small"
                    dangerouslySetInnerHTML={{ __html: art(REMIX.parentStudy, "parent") }}
                  />
                  <div className="parent-text">
                    <span>{REMIX.parentLabel}</span>
                    <span className="id">{REMIX.parentId}</span>
                  </div>
                </div>
                <div
                  className="art remix-art"
                  dangerouslySetInnerHTML={{ __html: art(remixStudy, "remix", true) }}
                />
                <div
                  className={captionVisible ? "remix-caption" : "remix-caption hidden"}
                >
                  {REMIX.caption}
                </div>
                <div className="id-row">
                  <span className="id">{REMIX.ids[allocation]}</span>
                  <span className="quiet">{REMIX.statuses[allocation]}</span>
                </div>
                <div className="allocation">
                  <span className="asset">
                    <i className="dot" />
                    jupSOL
                  </span>
                  <strong>{allocation}%</strong>
                </div>
                <div className="allocation">
                  <span className="asset">
                    <i className="dot yellow" />
                    USDC
                  </span>
                  <strong>{100 - allocation}%</strong>
                </div>
                <label className="label" htmlFor="allocation">
                  Explore another allocation
                </label>
                <select
                  className="slider"
                  id="allocation"
                  aria-label="Illustrative existing-vault selection or allocation draft"
                  value={allocation}
                  onChange={(e) => setAllocation(Number(e.target.value))}
                >
                  {REMIX.allocations.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button className="button" onClick={previewRemix}>
                  {REMIX.preview}
                </button>
                <p className="micro">
                  {REMIX.explanations[allocation]}
                  <br />
                  {REMIX.micro}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="footnotes">
          {FOOTNOTES.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>

        <div className="footer">
          <span>
            {FOOTER_NOTE.split("\n").map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </span>
          <a href={FOOTER_LINK.href}>{FOOTER_LINK.label}</a>
        </div>

        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      </main>

      <dialog ref={dialogRef} aria-labelledby="dialogTitle">
        <h2 id="dialogTitle">{SHARE_DIALOG.title}</h2>
        <div>
          <ShareCard
            study={study}
            caption={currentCaption}
            captionVisible={captionVisible}
            artSuffix="dialog"
          />
        </div>
        <p>{SHARE_DIALOG.note}</p>
        <form method="dialog">
          <button className="button">{SHARE_DIALOG.close}</button>
        </form>
      </dialog>
    </>
  );
}
