/** Supplied Coloyond artwork is the canonical identity across all clients. */
export function MixMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <img src="/coloyond.jpg" alt="" className={`shrink-0 rounded-[6px] ${className}`} style={{width:size,height:size,objectFit:'cover'}} />;
}
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`select-none font-display font-bold leading-none tracking-[-0.04em] text-ink ${className}`}>Coloyond</span>;
}
export function BrandLockup({ wordmarkSize = 'text-[19px]' }: { wordmarkSize?: string }) {
  return <span className="flex items-center gap-2"><MixMark size={28}/><Wordmark className={wordmarkSize}/></span>;
}
