import { Link, useParams } from 'react-router';
import { useMyParticipants } from '../features/participants/api';
import { validParticipantId } from '../features/participants/model';
import { ParticipantFacts, ParticipantsFailure } from '../features/participants/ParticipantsView';
import styles from '../features/participants/Participants.module.css';

export function ParticipantDetailPage() {
  const id = validParticipantId(useParams().id);
  const query = useMyParticipants(id !== null);
  const participant = query.data?.find(item => item.id === id);
  return <section className="container contentPage">
    <Link className={styles.back} to="/account">← В личный кабинет</Link>
    <h1>Карточка участника</h1>
    {id === null ? <div className={styles.state}><h2>Некорректный номер участника</h2><p>Откройте участника из своего списка в кабинете.</p></div>
      : query.isPending || (query.isFetching && !participant) ? <p className={styles.state} role="status">Загружаем участника…</p>
        : query.isError ? <ParticipantsFailure error={query.error} pending={query.isFetching} retry={() => void query.refetch()} />
          : participant ? <article className={styles.detail}><p className={styles.route}>{participant.route_name}</p><h2>{participant.surname} {participant.name}</h2><p>ID участника: {participant.id}</p><ParticipantFacts participant={participant} /><p className={styles.note}>Номер анкеты и номер физической карты — разные идентификаторы. Данные и отметки показаны по ответу сервера.</p><div className={styles.actions}><Link className={styles.secondary} to={`/account/participants/${participant.id}/pay`}>Тестовая оплата</Link></div><p className={styles.note}>Тестовый режим — без списания денег.</p></article>
            : <div className={styles.state}><h2>Участник не найден среди ваших записей</h2><p>Проверьте номер или вернитесь к своему списку.</p></div>}
    {id !== null && query.isFetching && !query.isPending && <p role="status" className={styles.progress}>Обновляем данные участника…</p>}
  </section>;
}
