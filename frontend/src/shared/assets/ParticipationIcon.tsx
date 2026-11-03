// Small process symbols, deliberately unrelated to geographic route geometry.
export function ParticipationIcon({ step }: { step: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="30" fill={step % 2 ? '#e8eedf' : '#c4e7eb'} />
    <g stroke="#174834" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {step === 1 && <><path d="M18 45c0-13 28-6 28-23M18 45l-4-5m4 5 5-3" strokeDasharray="3 5" /><circle cx="45" cy="20" r="5" fill="#ffcf72" /><path d="m24 24 8-5 5 7-8 5Zm-4 5 6 5-4 6-6-5Z" /></>}
      {step === 2 && <><circle cx="32" cy="23" r="8" /><path d="M17 47v-4a15 15 0 0 1 30 0v4Z" fill="#f7f6f1" /></>}
      {step === 3 && <><circle cx="25" cy="23" r="7" /><path d="M12 46v-3a13 13 0 0 1 26 0v3Z" /><path d="M41 18a7 7 0 0 1 0 14m2 5a12 12 0 0 1 9 9H43" /></>}
      {step === 4 && <><rect x="12" y="19" width="40" height="28" rx="4" fill="#f7f6f1" /><path d="M12 28h40M19 38h11" /><circle cx="43" cy="38" r="3" fill="#ffcf72" /></>}
      {step === 5 && <><path d="M19 12h19l9 9v31H19Z" fill="#f7f6f1" /><path d="M38 12v10h9M25 30h15M25 37h15M25 44h8" /></>}
      {step === 6 && <><path d="m11 21 14-5 15 5 13-5v30l-13 5-15-5-14 5Z" fill="#f7f6f1" /><path d="M25 16v30m15-25v30M17 28v10m15-8v10m14-14v9" /></>}
    </g>
  </svg>;
}
