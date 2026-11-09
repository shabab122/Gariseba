export function RoadGraphic() {
  return <svg className="road-graphic" viewBox="0 0 600 378" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <pattern id="survey-grid" width="31" height="31" patternUnits="userSpaceOnUse">
        <path d="M31 0H0v31" stroke="#8db19a" strokeOpacity=".19" />
        <circle cx="1" cy="1" r="1" fill="#a9c4ac" fillOpacity=".23" />
      </pattern>
      <radialGradient id="survey-glow">
        <stop stopColor="#b9f36c" stopOpacity=".24" />
        <stop offset="1" stopColor="#92e44a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="body-light" x1="-72" y1="-139" x2="89" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#f0ffa0" /><stop offset=".48" stopColor="#c5ef73" /><stop offset="1" stopColor="#69a96a" />
      </linearGradient>
      <linearGradient id="glass" x1="-32" y1="-55" x2="41" y2="32" gradientUnits="userSpaceOnUse">
        <stop stopColor="#406950" /><stop offset="1" stopColor="#142d26" />
      </linearGradient>
      <linearGradient id="survey-route" x1="72" y1="304" x2="548" y2="31" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6eaa87" stopOpacity=".25" /><stop offset=".47" stopColor="#c9fa76" /><stop offset="1" stopColor="#e3ffad" stopOpacity=".35" />
      </linearGradient>
      <filter id="car-shadow" x="-75%" y="-55%" width="250%" height="230%"><feDropShadow dx="9" dy="14" stdDeviation="15" floodColor="#091712" floodOpacity=".85" /></filter>
    </defs>

    <path fill="url(#survey-grid)" d="M0 0h600v378H0z" />
    <ellipse cx="315" cy="192" rx="275" ry="186" fill="url(#survey-glow)" />
    <g stroke="#678e79" strokeOpacity=".37">
      <path d="M0 303h85l89-88h86l51-51h90l58-60h141M0 329h96l89-89h84l50-49h91l61-61h129" />
      <path d="M83 0v82l49 46h42v87m12-215v77l24 28v45m-15 228v-87l38-39m235 126v-91l-48-48v-47m61 14h119M351 0v45l81 77M0 60h54l36 35m440 283v-53l70-70" />
      <path d="M60 211h63l44-44M450 75h39l34-33h77M0 126h45l55 49m453-175v43" />
    </g>
    <g stroke="#a9cb90" strokeOpacity=".31">
      <circle cx="300" cy="190" r="93" /><circle cx="300" cy="190" r="130" strokeDasharray="2 6" /><circle cx="300" cy="190" r="163" />
      <path d="M300 17v35m0 276v34M128 190h35m274 0h38" />
    </g>
    <path d="M44 323h62l43-45h58l109-110h71l69-70h56l39-40" stroke="url(#survey-route)" strokeWidth="3" strokeDasharray="7 7" />
    <g stroke="#c7f081">
      <circle cx="149" cy="278" r="11" strokeOpacity=".42" /><circle cx="149" cy="278" r="4" fill="#d2f884" />
      <circle cx="456" cy="98" r="12" strokeOpacity=".49" /><circle cx="456" cy="98" r="4" fill="#d2f884" />
      <path d="M87 278h40m351-180h38" strokeOpacity=".67" />
    </g>
    <g transform="translate(300 190) rotate(36)" filter="url(#car-shadow)">
      <rect x="-60" y="-88" width="17" height="49" rx="6" fill="#0b1c17" stroke="#78916f" strokeWidth="1.6" />
      <rect x="43" y="-88" width="17" height="49" rx="6" fill="#0b1c17" stroke="#78916f" strokeWidth="1.6" />
      <rect x="-60" y="47" width="17" height="48" rx="6" fill="#0b1c17" stroke="#78916f" strokeWidth="1.6" />
      <rect x="43" y="47" width="17" height="48" rx="6" fill="#0b1c17" stroke="#78916f" strokeWidth="1.6" />
      <path d="M-25-120C-11-127 11-127 25-120c19 9 25 26 29 51l-1 140c0 31-11 44-32 50h-42c-22-7-32-20-32-50l-1-140c3-25 11-42 29-51Z" fill="url(#body-light)" stroke="#e5ffc1" strokeWidth="2" />
      <path d="M-31-107c14-7 48-7 62 0l9 29-11 12h-58l-11-12 9-29Z" fill="#aacd69" stroke="#7fa658" strokeWidth="1.4" />
      <path d="M-45-52c-9 0-18-4-18 3 0 7 11 11 18 9m90-12c9 0 18-4 18 3 0 7-11 11-18 9" fill="#a5d36a" stroke="#dfff9b" strokeWidth="1.5" />
      <path d="M-40-49c9-16 19-24 40-24s31 8 40 24l-7 14h-66l-7-14Z" fill="url(#glass)" stroke="#658656" strokeWidth="1.6" />
      <path d="M-29-41c18-6 40-6 58 0m-52-18c14-5 32-5 46 0" stroke="#789775" strokeOpacity=".67" />
      <path d="m-40-34 5 9v62l-6 12-4-9v-65l5-9Zm80 0-5 9v62l6 12 4-9v-65l-5-9Z" fill="#2b4e39" stroke="#7d9f67" strokeWidth="1.4" />
      <path d="M-29-25h58v65h-58z" fill="#d9f792" />
      <path d="M-23-20h46v55h-46z" stroke="#efffb9" strokeOpacity=".77" />
      <path d="M-34 48h68l6 20c-14 11-66 11-80 0l6-20Z" fill="url(#glass)" stroke="#6c925f" strokeWidth="1.5" />
      <path d="M-27 56h54m-57 7h60m-56 6h52" stroke="#83a279" strokeOpacity=".62" />
      <path d="M-39 87c17 10 61 10 78 0M-19 109h38" stroke="#75a263" strokeWidth="2" strokeLinecap="round" />
      <path d="m-42-92 10-15 10-4m64 19-10-15-10-4" stroke="#f5ffd0" strokeWidth="5" strokeLinecap="round" />
      <path d="m-42 90 7 11 9 4m68-15-7 11-9 4" stroke="#efab6d" strokeWidth="4" strokeLinecap="round" />
      <path d="M0-105v26m0 161v8" stroke="#edffb5" strokeWidth="1.5" strokeLinecap="round" />
    </g>
    <g fill="#c9dcb6" fontFamily="monospace" fontSize="11" letterSpacing="2">
      <text x="55" y="270">01</text><text x="521" y="102">02</text>
    </g>
    <g stroke="#90ac91" strokeOpacity=".65" strokeWidth="1.2">
      <path d="M27 57V31h26m520 26V31h-26M27 321v26h26m520-26v26h-26" />
    </g>
  </svg>;
}
