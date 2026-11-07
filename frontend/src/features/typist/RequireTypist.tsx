import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { sessionStore } from '../../shared/session/store';
import styles from './Typist.module.css';

function TypistFrame() {
  return <section className={`container contentPage ${styles.workspace}`}>
    <nav className={styles.navigation} aria-label="Рабочее место наборщика">
      <NavLink to="/staff/typist" end>Сценарии работы</NavLink>
      <NavLink to="/staff/typist/new">Бумажная анкета</NavLink>
      <NavLink to="/staff/typist/match">Сопоставление</NavLink>
      <NavLink to="/staff/typist/unlinked">Непривязанные карты</NavLink>
    </nav><Outlet />
  </section>;
}
export function RequireTypist() {
  const { session } = useAuth();
  return session?.role === 'typist' ? <TypistFrame key={sessionStore.getCredentials()?.epoch} />
    : <section className="container contentPage"><h1>Нет доступа</h1><p className={styles.intro}>Рабочее место доступно только наборщику. За доступом обратитесь к ответственному.</p><p>403 · Нет прав для этого раздела.</p></section>;
}
