/**
 * Marchio Heili — «cervello nel corpo»: un core centrale con tre satelliti
 * collegati. È la stessa idea del marchio del Core (`.brand-mark` nella
 * sidebar e `.bb-hub-mark` nell'hub del Business Brain), resa qui in SVG
 * riutilizzabile perché le app dell'ecosistema condividano un solo segno.
 *
 * Regole del design system (docs/DESIGN-SYSTEM-HEILI.md §4):
 * - sempre su navy o su superficie chiara neutra;
 * - un solo accento (menta/turchese);
 * - nessun testo dentro il marchio;
 * - dimensione minima ~31px.
 */
export function HeiliMark({
  size = 40,
  className,
  core = "var(--heili-menta, #00e1cd)",
  satellite = "var(--heili-menta, #00e1cd)",
  link = "rgba(255,255,255,.45)",
}: {
  size?: number;
  className?: string;
  core?: string;
  satellite?: string;
  link?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="Heili"
    >
      {/* i collegamenti partono dal core verso i tre satelliti */}
      <g stroke={link} strokeWidth="1.4" strokeLinecap="round">
        <line x1="20" y1="20" x2="20" y2="8" />
        <line x1="20" y1="20" x2="30.4" y2="26" />
        <line x1="20" y1="20" x2="9.6" y2="26" />
      </g>
      <circle cx="20" cy="8" r="4.1" fill={satellite} />
      <circle cx="30.4" cy="26" r="4.1" fill={satellite} />
      <circle cx="9.6" cy="26" r="4.1" fill={satellite} />
      {/* il core resta pieno e più grande: è il centro del cervello */}
      <circle cx="20" cy="20" r="5.4" fill={core} />
    </svg>
  );
}
