import { Link } from 'react-router';
import { useMyParticipants } from '../features/participants/api';
import { ParticipantsFailure, ParticipantsList } from '../features/participants/ParticipantsView';
import styles from '../features/participants/Participants.module.css';

export function AccountPage() {
  const query = useMyParticipants();
  return (
    <section className="container contentPage" aria-labelledby="account-title">
      <p className={styles.eyebrow}>Ваше пространство</p>
      <h1 id="account-title">Личный кабинет</h1>
      <p className="intro">У каждого участника — своя анкета и свой маршрут.</p>
      <div className={styles.toolbar}><h2>Мои участники</h2><button type="button" className={styles.secondary} disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить</button><Link className="primaryButton" to="/account/participants/new">Добавить участника <span aria-hidden="true">＋</span></Link></div>
      {query.isPending && <p className={styles.state} role="status">Загружаем ваших участников…</p>}
      {query.isFetching && !query.isPending && <p className={styles.progress} role="status">Обновляем список участников…</p>}
      {query.isError && <ParticipantsFailure error={query.error} pending={query.isFetching} retry={() => void query.refetch()} />}
      {query.isSuccess && (query.data.length ? <ParticipantsList participants={query.data} /> : <div className={styles.state}><h2>Вы пока не зарегистрировали участников</h2><p>Можно добавить себя и близких. Для каждого участника выберите собственный маршрут.</p><Link className={styles.textLink} to="/account/participants/new">Добавить участника</Link></div>)}
      <p className={styles.note}>Сессия хранится только в памяти этой вкладки. После обновления страницы потребуется войти снова. Кнопка «Выйти» очищает локальную сессию, но не отзывает уже выданный сервером токен.</p>
    </section>
  );
}
