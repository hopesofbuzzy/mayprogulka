import { useLocation, useNavigate } from 'react-router';
import { useAuth } from './AuthProvider';

export function LogoutButton({ className }: { className?: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  return <button type="button" className={className} onClick={() => { logout(location.key); void navigate('/login', { replace: true, state: null }); }}>Выйти из аккаунта</button>;
}
