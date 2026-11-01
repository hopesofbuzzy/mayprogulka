import { Link } from 'react-router';
import type { Participant } from './model';
import { paymentLabel } from './model';
import { participantsError } from './api';
import styles from './Participants.module.css';

export function ParticipantFacts({ participant }: { participant: Participant }) {
  return <dl className={styles.facts}>
    <div><dt>Номер анкеты</dt><dd>{participant.form_id}</dd></div>
    <div><dt>Оплата</dt><dd>{paymentLabel(participant.payment_status)}</dd></div>
    <div><dt>Старт</dt><dd>{participant.has_started ? 'Отмечен' : 'Не отмечен'}</dd></div>
    <div><dt>Финиш</dt><dd>{participant.has_finished ? 'Отмечен' : 'Не отмечен'}</dd></div>
    <div className={styles.full}><dt>Номер физической карты</dt><dd>{participant.map_barcode || 'Пока не указан'}</dd></div>
  </dl>;
}

export function ParticipantsList({ participants }: { participants: Participant[] }) {
  return <ul className={styles.list} aria-label="Мои участники">{participants.map(participant => <li key={participant.id} className={styles.card}>
    <p className={styles.route}>{participant.route_name}</p>
    <h2>{participant.surname} {participant.name}</h2>
    <ParticipantFacts participant={participant} />
    <Link className={styles.textLink} to={`/account/participants/${participant.id}`} aria-label={`Подробнее: ${participant.surname} ${participant.name}`}>Подробнее <span aria-hidden="true">↗</span></Link>
  </li>)}</ul>;
}

export function ParticipantsFailure({ error, retry, pending }: { error: Error; retry: () => void; pending: boolean }) {
  return <div className={styles.state} role="alert"><h2>Участники пока недоступны</h2><p>{participantsError(error)}</p><button type="button" className={styles.secondary} disabled={pending} onClick={retry}>{pending ? 'Загружаем…' : 'Повторить загрузку'}</button></div>;
}
