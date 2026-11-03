import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { routesError, routesQuery } from '../features/routes/api';
import { sessionStore } from '../shared/session/store';
import { safeMapUrl } from '../shared/lib/safeMapUrl';
import { useAdminOperation } from '../features/adminRoutes/operation';
import { Editor } from '../features/adminRoutes/Editor';
import styles from '../features/adminRoutes/AdminRoutes.module.css';

export function AdminRoutesPage() {
  const epoch = sessionStore.getCredentials()?.epoch ?? -1;
  const query = useQuery(routesQuery), op = useAdminOperation(epoch);
  const opener = useRef<HTMLElement | null>(null);
  const restoreRequested = useRef(false);
  useEffect(() => {
    if (!op.editor && restoreRequested.current) {
      restoreRequested.current = false;
      const target = opener.current?.isConnected ? opener.current : document.getElementById('main');
      target?.focus();
    }
  }, [op.editor]);
  const editorId = op.editor?.result?.id ?? op.editor?.baseline?.id;
  const current = query.isSuccess ? query.data.find(route => route.id === editorId) : undefined;
  return <section className={`container contentPage ${styles.workspace}`}>
    <p className={styles.eyebrow}>Рабочее место администратора</p><h1>Управление маршрутами</h1>
    <p className={styles.intro}>Здесь показаны опубликованные маршруты. Скрытые и архивные записи могут отсутствовать.</p>
    <div className={styles.toolbar}><h2>Существующие маршруты</h2><button type="button" className={styles.secondary} disabled={query.isFetching || Boolean(op.editor)} onClick={() => void op.check()}>Обновить каталог</button><button type="button" className="primaryButton" disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; op.open('create'); }}>Новый маршрут</button></div>
    <p className={styles.hint}>КП открываются отдельно для каждого маршрута. Активность не подтверждает открытие регистрации; схемы здесь изменить нельзя.</p>
    {query.isPending && <p role="status">Загружаем маршруты…</p>}
    {query.isError && <div role="alert" className={styles.panel}><p>{routesError(query.error)}</p><button type="button" className={styles.secondary} disabled={query.isFetching} onClick={() => void op.check()}>Повторить загрузку каталога</button></div>}
    {query.isSuccess && (query.data.length ? <ul className={styles.list} aria-label="Маршруты из публичного каталога">
      {query.data.map(route => <li className={styles.panel} key={route.id}><p className={styles.hint}>ID {route.id} · {route.year} год · {route.distance} км</p><h3>{route.name}</h3><p>Активность: {route.is_active ? 'Да' : 'Нет'}</p>{route.description && <p className={styles.description}>{route.description}</p>}
        {safeMapUrl(route.map_url) ? <a className={styles.mapLink} href={safeMapUrl(route.map_url)!} target="_blank" rel="noopener noreferrer">Открыть схему ↗ (в новой вкладке)</a> : <p className={styles.hint}>{route.map_url ? 'Адрес схемы не прошёл проверку.' : 'Схема не указана.'}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; op.open('edit', route); }}>Изменить<span className={styles.srOnly}> «{route.name}»</span></button><button type="button" className={styles.danger} disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; op.open('delete', route); }}>Удалить<span className={styles.srOnly}> «{route.name}»</span></button><Link to={`/staff/routes/${route.id}/checkpoints`}>Контрольные пункты<span className={styles.srOnly}> «{route.name}»</span> →</Link><Link to={`/routes/${route.id}`}>Публичная страница →</Link></div>
      </li>)}
    </ul> : <p className={styles.panel} role="status">В публичном каталоге маршрутов пока нет.</p>)}
    {op.editor && <Editor op={op} current={current} catalog={query.isSuccess ? query.data : undefined} available={Boolean(current)} restoreFocus={() => { restoreRequested.current = true; }} />}
  </section>;
}
