export function TrendChart() {
  return (
    <svg viewBox="0 0 760 250" width="100%" height="240" preserveAspectRatio="none">
      <g stroke="var(--line)" strokeWidth="1">
        <line x1="0" y1="50" x2="760" y2="50" />
        <line x1="0" y1="110" x2="760" y2="110" />
        <line x1="0" y1="170" x2="760" y2="170" />
        <line x1="0" y1="230" x2="760" y2="230" />
      </g>
      <g fill="var(--card-2)">
        <rect x="8" y="155" width="16" height="75" />
        <rect x="34" y="162" width="16" height="68" />
        <rect x="60" y="146" width="16" height="84" />
        <rect x="86" y="156" width="16" height="74" />
        <rect x="112" y="138" width="16" height="92" />
        <rect x="138" y="150" width="16" height="80" />
        <rect x="164" y="142" width="16" height="88" />
        <rect x="190" y="128" width="16" height="102" />
        <rect x="216" y="146" width="16" height="84" />
        <rect x="242" y="136" width="16" height="94" />
        <rect x="268" y="154" width="16" height="76" />
        <rect x="294" y="126" width="16" height="104" />
        <rect x="320" y="138" width="16" height="92" />
        <rect x="346" y="130" width="16" height="100" />
        <rect x="372" y="142" width="16" height="88" />
        <rect x="398" y="124" width="16" height="106" />
        <rect x="424" y="132" width="16" height="98" />
        <rect x="450" y="138" width="16" height="92" />
        <rect x="476" y="122" width="16" height="108" />
        <rect x="502" y="128" width="16" height="102" />
        <rect x="528" y="134" width="16" height="96" />
        <rect x="554" y="118" width="16" height="112" />
        <rect x="580" y="126" width="16" height="104" />
        <rect x="606" y="132" width="16" height="98" />
        <rect x="632" y="116" width="16" height="114" />
      </g>
      <defs>
        <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--violet)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M16,182 C70,172 100,152 160,148 C230,140 310,122 390,112 C470,102 550,88 650,80 L650,230 L16,230 Z"
        fill="url(#rev)"
      />
      <polyline
        fill="none"
        stroke="var(--violet-2)"
        strokeWidth="2.4"
        points="16,182 48,174 80,170 112,152 144,148 176,140 208,142 240,130 272,122 304,126 336,114 368,110 400,118 432,100 464,104 496,94 528,86 560,92 592,82 650,80"
      />
      <polyline
        fill="none"
        stroke="var(--emerald)"
        strokeWidth="2.4"
        points="16,198 48,192 80,194 112,180 144,172 176,178 208,168 240,154 272,160 304,148 336,154 368,142 400,148 432,130 464,136 496,124 528,130 560,112 592,118 650,106"
      />
      <polyline
        fill="none"
        stroke="var(--violet-2)"
        strokeWidth="2"
        strokeDasharray="5 4"
        opacity=".7"
        points="650,80 685,74 720,68 755,60"
      />
      <polyline
        fill="none"
        stroke="var(--emerald)"
        strokeWidth="2"
        strokeDasharray="5 4"
        opacity=".7"
        points="650,106 685,98 720,92 755,84"
      />
      <circle cx="650" cy="80" r="3.5" fill="var(--violet-2)" />
      <circle cx="650" cy="106" r="3.5" fill="var(--emerald)" />
    </svg>
  )
}
