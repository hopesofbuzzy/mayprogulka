import { useNavigate } from 'react-router';
import { useAuth } from './AuthProvider';

export function LogoutButton({ className }: { className?: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return <button type="button" className={className} onClick={() => { logout(); void navigate('/login', { replace: true }); }}>Выйти</button>;
}
