/**
 * Navigation.
 *
 * Projects is deliberately ABSENT from the global bar: it is a tab inside the
 * Tasks area (brief §7, and independently confirmed by the Tasks layout
 * reference, which places Projects in the Tasks tab bar).
 */

export interface NavItem {
  label: string;
  href: string;
  /** Routes that should light this item up. */
  match: string[];
}

export const navItems: NavItem[] = [
  { label: "Home", href: "/", match: ["/", "/home"] },
  { label: "Tasks", href: "/tasks", match: ["/tasks"] },
  { label: "Score", href: "/score", match: ["/score"] },
  { label: "Team", href: "/team", match: ["/team", "/people"] },
  { label: "Goals", href: "/goals", match: ["/goals"] },
  { label: "Mail", href: "/mail", match: ["/mail"] },
  { label: "Messages", href: "/messages", match: ["/messages", "/groups"] },
  { label: "Meetings", href: "/meetings", match: ["/meetings"] },
  { label: "Workspace", href: "/workspace", match: ["/workspace"] },
];

/**
 * The administration entry.
 *
 * **Absent from `navItems` on purpose, and appended only for an administrator.**
 * Everybody else must not see it: an entry that leads to a redirect teaches people
 * the product is broken, and one that names a console they cannot open invites
 * them to ask why.
 *
 * Visibility is NOT what protects the route. `app/admin/layout.tsx` refuses it
 * server-side from the archetype before a byte reaches the browser, and every
 * settings write is authorised again in the repository. Hiding the link is
 * courtesy; the gate is elsewhere.
 *
 * Last in the bar, after the work. Administration is something a person does
 * occasionally and their own work is what they came for.
 */
export const ADMIN_NAV_ITEM: NavItem = {
  label: "Admin",
  href: "/admin",
  match: ["/admin"],
};

/**
 * Music is appended only when the deployment enables it, so a disabled build
 * shows no dead entry. It sits last: it is a personal utility, not work.
 *
 * `/yt` is deliberately ABSENT from the global bar. Video is a destination
 * someone chooses from inside Music, not a place the product invites a working
 * day to wander into.
 */
export function visibleNavItems(
  musicEnabled: boolean,
  isAdmin = false,
): NavItem[] {
  const items = musicEnabled
    ? [
        ...navItems,
        { label: "Music", href: "/music", match: ["/music", "/yt"] },
      ]
    : navItems;
  /* Defaulted to false so a caller that has not resolved the archetype yet shows
     no Admin entry rather than flashing one and withdrawing it. Least privilege
     while a session is still loading. */
  return isAdmin ? [...items, ADMIN_NAV_ITEM] : items;
}

/** Sub-navigation for the Tasks area. Projects lives here. */
export const taskTabs = [
  { id: "overview", label: "Overview", href: "/tasks?view=overview" },
  { id: "tasks", label: "Tasks", href: "/tasks?view=tasks" },
  { id: "projects", label: "Projects", href: "/tasks/projects" },
  { id: "timeline", label: "Timeline", href: "/tasks?view=timeline" },
  { id: "approvals", label: "Approvals", href: "/tasks?view=approvals" },
] as const;

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/" || pathname === "/home";
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
