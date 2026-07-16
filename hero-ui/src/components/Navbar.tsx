const NAV_LINKS = [
  "Home",
  "Voyages",
  "Worlds",
  "Innovation",
  "Plan Launch",
] as const;

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 17L17 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 7H17V17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Navbar() {
  return (
    <header className="fixed top-4 inset-x-0 z-50 px-8 lg:px-16">
      <div className="flex items-center justify-between">
        <div
          className="liquid-glass rounded-full w-12 h-12 flex items-center justify-center"
          aria-hidden="true"
        >
          <span className="font-heading text-white text-3xl leading-none -mt-0.5">
            a
          </span>
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <nav className="liquid-glass rounded-full px-1.5 py-1.5 flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link}
                href="#"
                className="px-3 py-2 text-sm font-medium text-white/90 font-body hover:opacity-80"
              >
                {link}
              </a>
            ))}
          </nav>

          <a
            href="#"
            className="liquid-glass-strong rounded-full bg-white text-black px-5 py-2.5 text-sm font-medium whitespace-nowrap flex items-center gap-2 hover:opacity-90"
          >
            Claim a Spot
            <ArrowUpRightIcon className="w-5 h-5" />
          </a>
        </div>

        {/* spacer */}
        <div className="w-12 h-12 opacity-0" aria-hidden="true" />
      </div>
    </header>
  );
}
