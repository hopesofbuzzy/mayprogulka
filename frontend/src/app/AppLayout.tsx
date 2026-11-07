import { AuthProvider } from '../features/auth/AuthProvider';
import { PublicLayout } from '../layouts/PublicLayout';

export function AppLayout() {
  return <AuthProvider><PublicLayout /></AuthProvider>;
}
