import { NavLink } from 'react-router';
import styles from './PublicLayout.module.css';

export function PublicFooter() {
  return <footer className={styles.footer}><div className={`container ${styles.footerInner}`}>
    <div className={styles.footerBrand}><p>Майская прогулка</p><span>Екатеринбург · с 1984 года</span></div>
    <nav aria-label="Навигация в футере"><NavLink to="/" end>Главная</NavLink><NavLink to="/routes">Маршруты</NavLink><NavLink to="/about">О прогулке</NavLink><NavLink to="/how-to">Как участвовать</NavLink><NavLink to="/faq">Вопросы</NavLink></nav>
  </div></footer>;
}
