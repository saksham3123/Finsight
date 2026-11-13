import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import ChatWidget from "./ChatWidget";
import { STORAGE_KEYS, writeStorage } from "../../utils/storage";

// Saves the current route so the next visit reopens it (restored in App.jsx).
function RememberRoute() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    writeStorage(STORAGE_KEYS.lastRoute, pathname + search);
  }, [pathname, search]);
  return null;
}

/** App shell for signed-in pages: sticky header, page content and the assistant. */
export default function Layout() {
  const { pathname } = useLocation();
  // Braces matter: newer browsers return a Promise from scrollTo, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <RememberRoute />
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 lg:py-8">
        <Outlet />
      </main>
      <ChatWidget />
    </div>
  );
}

/** Page title row used at the top of every page. */
export function PageTitle({ title, subtitle, action }) {
  useEffect(() => {
    document.title = `${title} | FinSight`;
  }, [title]);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
