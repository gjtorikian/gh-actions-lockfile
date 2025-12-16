import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { docsNavigation } from "@/lib/docs-config";

interface MobileNavProps {
  currentPath: string;
}

export function MobileNav({ currentPath }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  function isActive(href: string): boolean {
    return currentPath === href || currentPath === href + "/";
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setIsOpen(false)}
          />
          <nav className="fixed inset-y-0 left-0 z-50 w-72 bg-background border-r p-6 overflow-y-auto lg:hidden">
            <div className="mb-6">
              <a href="/" className="text-lg font-bold">
                gh-actions-lockfile
              </a>
            </div>
            <div className="space-y-6">
              {docsNavigation.map((section) => (
                <div key={section.title}>
                  <h4 className="mb-2 text-sm font-semibold text-foreground">
                    {section.title}
                  </h4>
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                            isActive(item.href)
                              ? "bg-accent text-accent-foreground font-medium"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          }`}
                          onClick={() => setIsOpen(false)}
                        >
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
