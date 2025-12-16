export interface NavItem {
  title: string;
  href: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const docsNavigation: NavSection[] = [
  {
    title: "Guide",
    items: [
      { title: "Getting Started", href: "/docs/getting-started" },
      { title: "Usage", href: "/docs/usage" },
      { title: "Commands", href: "/docs/commands" },
      { title: "CLI Reference", href: "/docs/cli-reference" },
    ],
  },
];

export const githubUrl = "https://github.com/gjtorikian/gh-actions-lockfile";
