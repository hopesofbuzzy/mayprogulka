import { Link } from 'react-router';
import { WalkingScene } from '../shared/assets/WalkingScene';
import { WalkingSceneCompact } from '../shared/assets/WalkingSceneCompact';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <>
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Традиция Екатеринбурга</p>
          <h1 id="home-title">Город становится<br /><span>ближе,</span> когда<br />идёшь пешком.</h1>
          <p className={styles.description}>Один день, тысячи шагов и маршруты для любого характера. Прогулка по любимому городу, лесным тропам и новым местам — вместе или самостоятельно.</p>
          <div className={styles.actions}>
            <Link className="primaryButton" to="/routes">Выбрать маршрут <span aria-hidden="true">↗</span></Link>
            <Link className={styles.guideLink} to="/how-to">Как участвовать <span aria-hidden="true">↓</span></Link>
          </div>
          <p className={styles.note}><span aria-hidden="true">✓</span> Это не гонка. Побеждает каждый, кто дошёл до финиша.</p>
        </div>
        <div className={styles.scene}>
          <WalkingScene />
          <div className={styles.sceneBadge} aria-hidden="true">
            <svg width="30" height="32" viewBox="0 0 30 32" fill="none" aria-hidden="true" focusable="false"><path d="M5 28 22 5M12 20C1 20 1 12 4 7c8 2 10 6 8 13Zm4-6c-1-8 6-11 11-10 0 7-4 11-11 10Zm-7 9c4-6 11-6 16-2-4 6-10 7-16 2Z" fill="#75a536"/><path d="M13 17C7 12 9 7 12 3c5 4 7 8 1 14Z" fill="#4c892c"/></svg>
            <span><strong>Испытай себя!</strong><small>Выбери свою дистанцию</small></span>
          </div>
        </div>
        <div className={styles.compactScene}><WalkingSceneCompact /></div>
      </div>
    </section>
    <section className={`container ${styles.editorial} ${styles.routeSection}`} aria-labelledby="choose-title">
      <div><p className={styles.sectionLabel}>В своём темпе</p><h2 id="choose-title">Выбрать<br /> свой путь</h2></div>
      <div className={styles.sectionCopy}><p>Начните с маршрута, который хочется пройти. В каталоге можно посмотреть дистанции и описания — и выбрать свой путь.</p><Link className={styles.textLink} to="/routes">Посмотреть маршруты <span aria-hidden="true">↗</span></Link></div>
    </section>
    <section className={styles.participation} aria-labelledby="participation-title">
      <div className={`container ${styles.editorial}`}>
        <div className={styles.sectionHeading}><p className={styles.sectionLabel}>От первого шага до старта</p><h2 id="participation-title">Как устроено участие</h2><Link className={styles.textLink} to="/how-to">Инструкция по шагам <span aria-hidden="true">→</span></Link></div>
        <ol className={styles.steps} aria-label="Коротко об участии">
          <li><h3>Выберите маршрут</h3><p>Откройте каталог и познакомьтесь с дистанциями.</p></li>
          <li><h3>Заполните анкеты</h3><p>Создайте аккаунт или войдите. Один аккаунт может зарегистрировать нескольких участников, каждого — на свой маршрут.</p><Link to="/account/participants/new">К регистрации участников →</Link></li>
          <li><h3>Подготовьте анкету</h3><p>Если ссылка на файл доступна, распечатайте анкету и возьмите её на старт. Если ссылки нет, уточните оформление у организаторов.</p></li>
          <li><h3>Получите карту</h3><p>Физическую карту получают отдельно на старте. Онлайн-регистрация её не заменяет.</p></li>
        </ol>
      </div>
    </section>
    <section className={`container ${styles.editorial} ${styles.tradition}`} aria-labelledby="tradition-title">
      <p className={styles.year}>С 1984<span>года</span></p>
      <div className={styles.sectionCopy}><p className={styles.sectionLabel}>Традиция и город</p><h2 id="tradition-title">Екатеринбург.<br />Пешком. Вместе.</h2><p>«Майская прогулка» — традиция Екатеринбурга с 1984 года. Повод выйти на прогулку, посмотреть вокруг и разделить дорогу с близкими.</p><Link className={styles.textLink} to="/about">О прогулке <span aria-hidden="true">→</span></Link></div>
    </section>
    <section className={styles.closing} aria-labelledby="closing-title"><div className={`container ${styles.closingInner}`}><div><p className={styles.sectionLabel}>Первый шаг — ваш</p><h2 id="closing-title">Куда отправимся?</h2><p>Познакомьтесь с маршрутами и найдите свой.</p></div><div className={styles.closingActions}><Link className="primaryButton" to="/routes">Открыть каталог <span aria-hidden="true">↗</span></Link><Link className={styles.textLink} to="/faq">Остались вопросы? →</Link></div></div></section>
    </>
  );
}
