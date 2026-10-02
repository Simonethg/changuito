type IconProps = { className?: string };

function stroke(className?: string) {
  return {
    className,
    viewBox: '0 0 32 32',
    width: 32,
    height: 32,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
}

export function AskIcon({ className }: IconProps) {
  return (
    <svg {...stroke(className)}>
      <path d="M8 8h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H14l-5 4v-4H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function CompareIcon({ className }: IconProps) {
  return (
    <svg {...stroke(className)}>
      <path d="M8 22V12" />
      <path d="M16 22V8" />
      <path d="M24 22v-6" />
      <path d="M6 22h20" />
    </svg>
  );
}

export function ConfirmIcon({ className }: IconProps) {
  return (
    <svg {...stroke(className)}>
      <rect x="7" y="6" width="18" height="20" rx="2" />
      <path d="M12 16l3 3 6-7" />
    </svg>
  );
}

export function PayIcon({ className }: IconProps) {
  return (
    <svg {...stroke(className)}>
      <rect x="5" y="9" width="22" height="14" rx="2" />
      <path d="M5 14h22" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...stroke(className)}>
      <circle cx="16" cy="16" r="10" />
      <path d="M11 16.5l3.2 3.2L21.5 12" />
    </svg>
  );
}

/** Compact social glyphs (viewBox 24) so they sit next to footer text. */
function socialStroke(className?: string) {
  return {
    className,
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg {...socialStroke(className)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg {...socialStroke(className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 11v6" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <path d="M12 17v-3.5a2 2 0 0 1 4 0V17" />
    </svg>
  );
}

const ICONS = {
  ask: AskIcon,
  compare: CompareIcon,
  confirm: ConfirmIcon,
  pay: PayIcon,
} as const;

export function StepIcon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} />;
}
