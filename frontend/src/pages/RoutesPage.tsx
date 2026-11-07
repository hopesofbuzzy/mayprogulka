import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { routesQuery, routesError } from '../features/routes/api';
import { safeMapUrl } from '../shared/lib/safeMapUrl';
import styles from './RoutesPage.module.css';

export function RoutesPage() {
  const query = useQuery(routesQuery);
  const activeRoutes = query.data?.filter(route => route.is_active);
  return (
    <section className="contentPage container" aria-labelledby="routes-title">
      <p className={styles.eyebrow}>Навстречу прогулке</p>
      <h1 id="routes-title">Маршруты</h1>
      <p className="intro">У каждого свой путь. Посмотрите дистанции и описания маршрутов.</p>
      <p className={styles.disclaimer}>Год и статус указаны по данным организаторов. Активный маршрут не означает, что регистрация открыта.</p>
      {query.isPending && <div className={styles.state} role="status">Загружаем маршруты…</div>}
      {query.isError && (
        <div className={styles.state} role="alert">
          <h2>Маршруты пока недоступны</h2>
          <p>{routesError(query.error)}</p>
          <button className="primaryButton" onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? 'Повторяем запрос…' : 'Повторить'}</button>
        </div>
      )}
      {query.isSuccess && activeRoutes?.length === 0 && <div className={styles.state} role="status"><h2>Маршрутов пока нет</h2><p>Когда организаторы откроют маршруты, они появятся здесь.</p></div>}
      {query.isSuccess && activeRoutes && activeRoutes.length > 0 && (
        <ul className={styles.list} aria-label="Список маршрутов">
          {activeRoutes.map((route) => {
            const mapUrl = safeMapUrl(route.map_url);
            return (
              <li key={route.id} className={styles.card}>
                <div className={styles.cardTop}><span>{route.year} год</span><span className={route.is_active ? styles.active : styles.inactive}>{route.is_active ? 'Активный' : 'Неактивный'}</span></div>
                <p className={styles.distance}>{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(route.distance)} <span>км</span></p>
                <h2>{route.name}</h2>
                {route.description && <p className={styles.description}>{route.description}</p>}
                {!route.is_active && <p className={styles.unavailable}>Недоступен для регистрации</p>}
                <div className={styles.cardFooter}><Link className={styles.detailsLink} to={`/routes/${route.id}`}>Подробнее о маршруте<span className={styles.srOnly}> «{route.name}»</span> <span aria-hidden="true">→</span></Link>
                {mapUrl ? <a className={styles.mapLink} href={mapUrl} target="_blank" rel="noopener noreferrer">Открыть карту <span aria-hidden="true">↗</span><span className={styles.srOnly}> (в новой вкладке)</span></a> : <p className={styles.mapNote}>{route.map_url ? 'Карта предоставлена. Внешний адрес требует проверки организаторами.' : 'Карта пока не предоставлена'}</p>}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
