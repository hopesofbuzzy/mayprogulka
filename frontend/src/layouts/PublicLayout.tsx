import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../shared/assets/Logo';
import { useAuth } from '../features/auth/AuthProvider';
import { LogoutButton } from '../features/auth/LogoutButton';
import styles from './PublicLayout.module.css';

function PublicNav() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const navId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <div className={styles.navigation} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <button ref={toggle} type="button" className={styles.menuToggle}
        aria-label={open ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={open} aria-controls={navId}
        onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d={open ? 'm5 5 10 10M5 15 15 5' : 'M3 5h14M3 10h14M3 15h14'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <nav id={navId} aria-label="Основная навигация" className={styles.nav} data-open={open} onClick={() => setOpen(false)}>
        <NavLink to="/" end>Главная</NavLink>
        <NavLink to="/routes">Маршруты</NavLink>
        <span aria-disabled="true" title="Раздел ещё не реализован">Вопросы</span>
        <span aria-disabled="true" title="Раздел ещё не реализован">Организаторам</span>
        {isAuthenticated && <LogoutButton className={styles.mobileLogout} />}
      </nav>
    </div>
  );
}

export function PublicLayout() {
  const { isAuthenticated, expired } = useAuth();
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      main.current?.focus();
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
    const title = ({ '/': 'Город становится ближе', '/routes': 'Маршруты', '/login': 'Вход', '/signup': 'Регистрация', '/account': 'Личный кабинет' } as Record<string, string>)[pathname] ?? 'Страница не найдена';
    document.title = `${title} — Майская прогулка`;
  }, [pathname]);
  return (
    <>
      <a className={styles.skip} href="#main">Перейти к содержимому</a>
      <div className={styles.topStrip} aria-hidden="true" />
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link to="/" className={styles.brand} aria-label="Майская прогулка — главная">
            <Logo />
            <span><strong>Екатеринбург</strong><small>с 1984 года</small></span>
          </Link>
          <PublicNav key={pathname} />
          <div className={styles.accountActions}>
            <Link className={styles.account} to={isAuthenticated ? '/account' : '/login'} aria-label="Личный кабинет"><span className={styles.accountPrefix}>Личный&nbsp;</span>кабинет <span aria-hidden="true">↗</span></Link>
            {isAuthenticated && <LogoutButton className={styles.desktopLogout} />}
          </div>
        </div>
      </header>
      {expired && <p className={styles.sessionNotice} role="status">Сессия завершена. <Link to="/login">Войдите снова</Link>, чтобы открыть личный кабинет.</p>}
      <main id="main" tabIndex={-1} ref={main}><Outlet /></main>
    </>
  );
}
