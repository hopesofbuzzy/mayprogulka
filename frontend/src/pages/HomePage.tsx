import { Link } from 'react-router';
import { WalkingScene } from '../shared/assets/WalkingScene';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Традиция Екатеринбурга</p>
          <h1 id="home-title">Город становится<br /><span>ближе,</span> когда<br />идёшь пешком.</h1>
          <p className={styles.description}>Один день, тысячи шагов и маршруты для любого характера. Прогулка по любимому городу, лесным тропам и новым местам — вместе или самостоятельно.</p>
          <div className={styles.actions}>
            <Link className="primaryButton" to="/routes">Выбрать маршрут <span aria-hidden="true">↗</span></Link>
            <button disabled title="Инструкция появится в следующей итерации">Как участвовать <span aria-hidden="true">↓</span></button>
          </div>
          <p className={styles.note}><span aria-hidden="true">✓</span> Это не гонка. Побеждает каждый, кто дошёл до финиша.</p>
        </div>
        <div className={styles.scene}>
          <WalkingScene />
          <div className={styles.sceneBadge} aria-hidden="true">
            <svg width="30" height="32" viewBox="0 0 30 32" fill="none"><path d="M5 28 22 5M12 20C1 20 1 12 4 7c8 2 10 6 8 13Zm4-6c-1-8 6-11 11-10 0 7-4 11-11 10Zm-7 9c4-6 11-6 16-2-4 6-10 7-16 2Z" fill="#75a536"/><path d="M13 17C7 12 9 7 12 3c5 4 7 8 1 14Z" fill="#4c892c"/></svg>
            <span><strong>Испытай себя!</strong><small>Выбери свою дистанцию</small></span>
          </div>
        </div>
      </div>
    </section>
  );
}
