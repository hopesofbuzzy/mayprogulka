import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Logo } from '../shared/assets/Logo';
import styles from './PublicLayout.module.css';

export function PublicLayout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      main.current?.focus();
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
    const title = pathname === '/' ? 'Город становится ближе' : pathname === '/routes' ? 'Маршруты' : 'Страница не найдена';
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
          <nav aria-label="Основная навигация" className={styles.nav}>
            <NavLink to="/" end>Главная</NavLink>
            <NavLink to="/routes">Маршруты</NavLink>
            <span aria-disabled="true" title="Раздел ещё не реализован">Вопросы</span>
            <span aria-disabled="true" title="Раздел ещё не реализован">Организаторам</span>
          </nav>
          <button className={styles.account} disabled title="Личный кабинет ещё не реализован">Личный кабинет <span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={main}><Outlet /></main>
    </>
  );
}
