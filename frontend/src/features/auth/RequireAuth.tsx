import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { safeReturnTo } from './redirect';
import { sessionStore } from '../../shared/session/store';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  return auth.isAuthenticated ? <Outlet /> : <Navigate to="/login" replace state={sessionStore.isAbandonedLocation(location.key) ? null : { returnTo: safeReturnTo(location.pathname + location.search + location.hash) }} />;
}
