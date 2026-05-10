import { Briefcase, MessageCircle, User } from "lucide-react";

type NavTarget = {
  label: string;
  href: string;
  Icon: typeof User;
};

// Phase 0.5: added "Jobs" — the universal aggregated feed lives at
// /jobs (was previously buried inside Overview's role grid).
const TARGETS: NavTarget[] = [
  { label: "Jobs", href: "/jobs", Icon: Briefcase },
  { label: "Profile", href: "/profile", Icon: User },
  { label: "Buddy", href: "/buddy", Icon: MessageCircle },
];

/**
 * Cinema-themed top navigation. Sticky, mist-glass over content, inks
 * are cinema-ink / cinema-pine. Replaces the prior purple chrome.
 */
export function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-cinema-mint/60 bg-cinema-cream/85 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
        <a
          href="/"
          className="font-semibold text-lg text-cinema-ink no-underline tracking-tight"
        >
          Career-Buddy
        </a>
        <div className="flex items-center gap-1 md:gap-2">
          {TARGETS.map((t) => (
            <NavLink key={t.label} target={t} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function NavLink({ target }: { target: NavTarget }) {
  return (
    <a
      href={target.href}
      className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-full text-base text-cinema-ink-soft hover:text-cinema-ink hover:bg-cinema-mint/60 no-underline transition-colors"
    >
      <target.Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{target.label}</span>
    </a>
  );
}
