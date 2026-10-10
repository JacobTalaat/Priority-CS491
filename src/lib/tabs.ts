export type Tab = {
  href: string;
  label: string;
};

export const TABS: readonly Tab[] = [
  { href: "/today", label: "Today" },
  { href: "/classes", label: "Classes" },
  { href: "/weights", label: "Weights" },
  { href: "/settings", label: "Settings" },
];

// A tab stays active on its own nested pages, e.g. /classes/42 keeps Classes lit.
export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
