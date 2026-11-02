import { Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { sessionStore } from '../../shared/session/store';

export function RequireAdmin() {
  const { session } = useAuth();
  return session?.role === 'admin' ? <Outlet key={sessionStore.getCredentials()?.epoch} />
    : <section className="container contentPage"><h1>Нет доступа</h1><p className="intro">403 · Для управления маршрутами требуется роль admin. Клиент не может назначить права. Административные запросы не выполнялись.</p></section>;
}
