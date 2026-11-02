import { useQuery } from '@tanstack/react-query';
import { unlinkedOptions, staffReadError, currentTypist } from '../features/typist/api';
import { sessionStore } from '../shared/session/store';
import styles from '../features/typist/Typist.module.css';
import common from '../features/participants/Participants.module.css';

export function TypistUnlinkedPage() {
  const epoch = sessionStore.getCredentials()?.epoch ?? -1;
  const query = useQuery({ ...unlinkedOptions(epoch), enabled: currentTypist(epoch) });
  return <><h1>Непривязанные карты</h1><p className={styles.intro}>Лимит запроса: 100 карт. Это ограниченная выборка: сервер не предоставляет общее количество и страницы полного реестра.</p><p className={styles.hint}>Отсутствие штрихкода в выборке не подтверждает его связь с нужной анкетой.</p>
    <div className={common.actions}><button className={common.secondary} type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить выборку</button></div>
    {query.isPending && <p role="status" className={styles.intro}>Загружаем выборку карт…</p>}
    {query.isFetching && !query.isPending && <p role="status" className={styles.intro}>Обновляем выборку карт…</p>}
    {query.isError && <div role="alert" className={common.alert}><p>{staffReadError(query.error)}</p><button className={common.secondary} type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку</button></div>}
    {query.isSuccess && (query.data.length ? <><p className={styles.hint}>Получено в выборке: {query.data.length}.</p><ul className={styles.mapList} aria-label="Выборка непривязанных карт">{query.data.map((map, index) => <li key={`${map.id}:${index}`}><span>Штрихкод физической карты</span><code className={styles.barcode}>{map.barcode}</code><p>ID записи карты: {map.id}</p>{map.participant_id !== undefined && map.participant_id !== null && <p>ID участника в ответе: {map.participant_id}</p>}</li>)}</ul></> : <p role="status" className={styles.panel}>В выборке нет карт. Это не является проверкой конкретной пары.</p>)}
  </>;
}
