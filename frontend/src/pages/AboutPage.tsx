import { Link } from 'react-router';
import { WalkingSceneCompact } from '../shared/assets/WalkingSceneCompact';
import styles from './AboutPage.module.css';

export function AboutPage() {
  return <article className={`container ${styles.page}`}>
    <header className={styles.intro}>
      <div><p className={styles.eyebrow}>Город, который узнаёшь шаг за шагом</p><h1>О Майской прогулке</h1><p className={styles.lead}>Традиция пешей прогулки в Екатеринбурге с 1984 года.</p></div>
      <div className={styles.art}><WalkingSceneCompact /></div>
    </header>
    <section className={styles.idea} aria-labelledby="about-idea"><h2 id="about-idea">Дорога начинается<br />с любопытства</h2><div><p>Знакомые улицы, новый взгляд на город и время, чтобы побыть вместе. «Майская прогулка» — приглашение посмотреть вокруг, идя пешком.</p><p>Выберите свой маршрут. Можно отправиться вместе с близкими: один аккаунт позволяет зарегистрировать нескольких участников, у каждого — свой выбор маршрута.</p></div></section>
    <section className={styles.next} aria-labelledby="about-next"><p className={styles.eyebrow}>От знакомства — к прогулке</p><h2 id="about-next">Начните со своего пути</h2><div className={styles.links}><Link to="/routes"><strong>Посмотреть маршруты <span aria-hidden="true">↗</span></strong><span>Дистанции и описания в каталоге</span></Link><Link to="/how-to"><strong>Подготовиться к участию <span aria-hidden="true">→</span></strong><span>От аккаунта и анкеты до физической карты</span></Link></div><Link className={styles.faqLink} to="/faq">Вопросы и ответы →</Link></section>
  </article>;
}
