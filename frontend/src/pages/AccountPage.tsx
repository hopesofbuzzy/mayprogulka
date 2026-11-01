import { Link } from 'react-router';
import styles from './AccountPage.module.css';

export function AccountPage() {
  return (
    <section className="container contentPage" aria-labelledby="account-title">
      <p className={styles.eyebrow}>Ваше пространство</p>
      <h1 id="account-title">Личный кабинет</h1>
      <p className="intro">Вы вошли в аккаунт «Майской прогулки».</p>
      <div className={styles.panel}>
        <span className={styles.icon} aria-hidden="true">✓</span>
        <h2>Хорошее начало</h2>
        <p>Раздел управления участниками появится отдельным этапом. Пока здесь можно завершить сеанс или перейти к маршрутам.</p>
        <Link className="primaryButton" to="/routes">Посмотреть маршруты <span aria-hidden="true">↗</span></Link>
      </div>
      <p className={styles.note}>Сессия хранится только в памяти этой вкладки. После обновления страницы потребуется войти снова. Кнопка «Выйти» очищает локальную сессию, но не отзывает уже выданный сервером токен.</p>
    </section>
  );
}
