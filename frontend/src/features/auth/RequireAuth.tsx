import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { safeReturnTo } from './redirect';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  return auth.isAuthenticated ? <Outlet /> : <Navigate to="/login" replace state={{ returnTo: safeReturnTo(location.pathname + location.search + location.hash) }} />;
}
