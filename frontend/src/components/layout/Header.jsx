import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { FaBars, FaChevronDown, FaGear, FaMoon, FaRightFromBracket, FaSun, FaUser, FaXmark } from "react-icons/fa6";
import Logo from "../ui/Logo";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";

export const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/stocks", label: "Stocks" },
  { to: "/ipos", label: "IPOs" },
  { to: "/sip", label: "SIP" },
  { to: "/crypto", label: "Crypto" },
];

const navLink = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
  }`;

// Closes a popover on outside click or Escape.
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, ref]);
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="grid size-9 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {dark ? <FaSun /> : <FaMoon />}
    </button>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  useDismiss(open, setOpen, ref);

  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink";
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const onLogout = async () => {
    setOpen(false);
    await logout();
    navigate("/login");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-2"
      >
        <span className="grid size-8 place-items-center rounded-full bg-series-1 text-xs font-bold text-white">{initials}</span>
        <span className="hidden text-sm font-medium text-ink md:inline">{user.name}</span>
        <FaChevronDown className={`text-xs text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link role="menuitem" to="/profile" className={item} onClick={() => setOpen(false)}>
            <FaUser aria-hidden="true" /> Profile
          </Link>
          <Link role="menuitem" to="/settings" className={item} onClick={() => setOpen(false)}>
            <FaGear aria-hidden="true" /> Settings
          </Link>
          <button role="menuitem" type="button" className={`${item} border-t border-line`} onClick={onLogout}>
            <FaRightFromBracket aria-hidden="true" /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <button
          type="button"
          className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <FaXmark /> : <FaBars />}
        </button>
        <Link to="/" aria-label="FinSight dashboard">
          <Logo />
        </Link>
        <nav aria-label="Main" className="ml-4 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={navLink}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
      {menuOpen && (
        <nav id="main-nav" aria-label="Main" className="border-t border-line px-4 py-2 lg:hidden">
          <ul className="flex flex-col gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={(s) => `block ${navLink(s)}`}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
