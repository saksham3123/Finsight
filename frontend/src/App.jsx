import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import { useAuth } from "./context/AuthContext";
import { readStorage, STORAGE_KEYS } from "./utils/storage";

// Each page is its own chunk, loaded on first visit.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Markets = lazy(() => import("./pages/Markets"));
const Ipos = lazy(() => import("./pages/Ipos"));
const Sip = lazy(() => import("./pages/Sip"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const NotFound = lazy(() => import("./pages/NotFound"));

// On a fresh load of "/", reopen the route the user was last on.
function RestoreLastRoute() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const last = readStorage(STORAGE_KEYS.lastRoute);
    if (pathname === "/" && last && last !== "/") navigate(last, { replace: true });
  }, [navigate, pathname]);
  return null;
}

// The app shell needs a signed-in user; guests are sent to /login (and come back afterwards).
function RequireAuth({ children }) {
  const { status } = useAuth();
  if (status === "loading") return null;
  if (status === "guest") return <Navigate to="/login" replace />;
  return children;
}

// Signed-in users who open /login or /register go straight to the app.
function GuestOnly({ children }) {
  const { status } = useAuth();
  if (status === "loading") return null;
  if (status === "authed") return <Navigate to={readStorage(STORAGE_KEYS.lastRoute, "/")} replace />;
  return children;
}

export default function App() {
  return (
    <>
      <RestoreLastRoute />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="stocks" element={<Markets key="stock" type="stock" />} />
            <Route path="stocks/:symbol" element={<Markets key="stock" type="stock" />} />
            <Route path="crypto" element={<Markets key="crypto" type="crypto" />} />
            <Route path="crypto/:symbol" element={<Markets key="crypto" type="crypto" />} />
            <Route path="ipos" element={<Ipos />} />
            <Route path="sip" element={<Sip />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
