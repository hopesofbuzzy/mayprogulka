import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { checkpointsError, checkpointsQuery, routesError, routesQuery } from '../features/routes/api';
import { parseRouteId } from '../features/routes/model';
import { safeMapUrl } from '../shared/lib/safeMapUrl';
import styles from './PublicContent.module.css';

function Checkpoints({ routeId }: { routeId: number }) {
  const query = useQuery(checkpointsQuery(routeId));
  return <section className={styles.panel} aria-labelledby="checkpoints-title">
    <p className={styles.eyebrow}>По пути</p>
    <h2 id="checkpoints-title">Контрольные пункты</h2>
    <p className={styles.muted}>Пункты перечислены по порядку маршрута. Метки старта и финиша описывают пункт, а не прохождение участника.</p>
    {query.isPending && <p role="status">Загружаем контрольные пункты…</p>}
    {query.isError && <div role="alert"><p>{checkpointsError(query.error)}</p><button className="primaryButton" disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку КП</button></div>}
    {query.isSuccess && (query.data.length ? <ol className={styles.checkpoints} aria-label="Контрольные пункты маршрута">
      {query.data.map(point => <li key={point.id}>
        <div className={styles.pointHeading}><span className={styles.order}>Порядок: {point.order}</span><h3>{point.name}</h3></div>
        <p>{point.address}</p>
        {(point.is_start || point.is_finish) && <p className={styles.tags}>{point.is_start && <span>Старт</span>}{point.is_finish && <span>Финиш</span>}</p>}
      </li>)}
    </ol> : <p role="status">Контрольные пункты пока не опубликованы.</p>)}
  </section>;
}

function ExistingRoute({ id }: { id: number }) {
  const query = useQuery(routesQuery);
  if (query.isPending) return <p className={styles.panel} role="status">Загружаем маршрут…</p>;
  if (query.isError) return <div className={styles.panel} role="alert"><h1>Маршрут пока недоступен</h1><p>{routesError(query.error)}</p><button className="primaryButton" disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку маршрутов</button></div>;
  const route = query.data.find(item => item.id === id);
  if (!route) return <div className={styles.panel}><h1>Маршрут не найден</h1><p>{query.data.length ? 'В полученном списке нет маршрута с таким номером.' : 'Сервис вернул пустой список маршрутов.'}</p></div>;
  const mapUrl = safeMapUrl(route.map_url);
  return <>
    <header className={styles.routeHeader}>
      <p className={styles.eyebrow}>Свой путь</p><h1>{route.name}</h1>
      <div className={styles.routeFacts}><span>{route.year} год</span><strong>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(route.distance)} км</strong><span className={styles.badge}>{route.is_active ? 'Активный маршрут' : 'Неактивный маршрут'}</span></div>
      <p className={styles.muted}>Активность маршрута не означает, что регистрация открыта.</p>
      {route.description && <p className={styles.description}>{route.description}</p>}
    </header>
    <div className={styles.routeGrid}>
      <Checkpoints key={id} routeId={id} />
      <aside className={styles.panel} aria-labelledby="map-title">
        <p className={styles.eyebrow}>Ориентир</p><h2 id="map-title">Схема маршрута</h2>
        <p>Изображение или файл схемы. Это не физическая маршрутная карта со штрихкодом, которую получают на старте.</p>
        {mapUrl ? <a className={styles.textLink} href={mapUrl} target="_blank" rel="noopener noreferrer">Открыть схему маршрута ↗ <span className={styles.srOnly}>(в новой вкладке)</span></a> : <p role="status">Схема маршрута пока недоступна.</p>}
        <hr /><h2>Следующий шаг</h2><p>В форме регистрации выберите маршрут отдельно для каждого участника.</p>
        <Link className="primaryButton" to="/account/participants/new">Зарегистрировать участников</Link>
        <Link className={styles.textLink} to="/how-to">Как участвовать →</Link>
      </aside>
    </div>
  </>;
}

export function RouteDetailPage() {
  const id = parseRouteId(useParams().routeId);
  return <article className={`contentPage container ${styles.page}`}>
    <Link className={styles.back} to="/routes">← Все маршруты</Link>
    {id === null ? <div className={styles.panel}><h1>Некорректный номер маршрута</h1><p>Откройте маршрут из каталога.</p></div> : <ExistingRoute id={id} />}
  </article>;
}
