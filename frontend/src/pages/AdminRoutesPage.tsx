import { useEffect, useRef, useState } from 'react';
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
  const [activity, setActivity] = useState('all');
  const visible = query.data?.filter(route => activity === 'all' || route.is_active === (activity === 'active'));
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
    <p className={styles.intro}>Создавайте маршруты и управляйте их контрольными пунктами. Архив сохраняет историю маршрута и связанных участников.</p>
    <div className={styles.toolbar}><h2>Существующие маршруты</h2><button type="button" className={styles.secondary} disabled={query.isFetching || Boolean(op.editor)} onClick={() => void op.check()}>Обновить каталог</button><button type="button" className="primaryButton" disabled={Boolean(op.editor) || op.blocked('create')} onClick={event => { opener.current = event.currentTarget; op.open('create'); }}>Новый маршрут</button></div>
    <label className={styles.filter}>Показывать маршруты<select value={activity} disabled={Boolean(op.editor)} onChange={event => setActivity(event.target.value)}><option value="all">Все</option><option value="active">Активные</option><option value="inactive">Архив</option></select></label>
    <p className={styles.hint}>Архивные маршруты скрыты из публичного каталога и недоступны при регистрации. Их можно восстановить. Анкеты и КП сохраняются.</p>
    {op.paused.map((item, index) => <div className={styles.alert} key={index} role="status"><p>Отложена операция с неизвестным исходом: {item.baseline?.name ?? 'новый маршрут'}. Сначала проверьте результат; новые изменения заблокированы.</p><button type="button" className={styles.secondary} disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; op.resume(index); }}>Открыть проверку отложенной операции {index + 1}</button></div>)}
    {query.isPending && <p role="status">Загружаем маршруты…</p>}
    {query.isError && <div role="alert" className={styles.panel}><p>{routesError(query.error)}</p><button type="button" className={styles.secondary} disabled={query.isFetching} onClick={() => void op.check()}>Повторить загрузку каталога</button></div>}
    {query.isSuccess && (visible?.length ? <ul className={styles.list} aria-label="Маршруты из публичного каталога">
      {visible.map(route => <li className={styles.panel} key={route.id}><p className={styles.hint}>ID {route.id} · {route.year} год · {route.distance} км</p><h3>{route.name}</h3><p>{route.is_active ? 'Активный маршрут' : 'В архиве'}</p>{route.description && <p className={styles.description}>{route.description}</p>}
        {safeMapUrl(route.map_url) ? <a className={styles.mapLink} href={safeMapUrl(route.map_url)!} target="_blank" rel="noopener noreferrer">Открыть схему ↗ (в новой вкладке)</a> : <p className={styles.hint}>{route.map_url ? 'Адрес схемы не прошёл проверку.' : 'Схема не указана.'}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={Boolean(op.editor) || op.blocked('edit', route)} onClick={event => { opener.current = event.currentTarget; if (route.is_active) op.archive(route); else op.restore(route); }}>{route.is_active ? 'Архивировать' : 'Восстановить'}<span className={styles.srOnly}> «{route.name}»</span></button><button type="button" className={styles.secondary} disabled={Boolean(op.editor) || op.blocked('edit', route)} onClick={event => { opener.current = event.currentTarget; op.open('edit', route); }}>Изменить<span className={styles.srOnly}> «{route.name}»</span></button><Link to={`/staff/routes/${route.id}/checkpoints`}>Контрольные пункты<span className={styles.srOnly}> «{route.name}»</span> →</Link>{route.is_active && <Link to={`/routes/${route.id}`}>Публичная страница →</Link>}</div>
      </li>)}
    </ul> : <p className={styles.panel} role="status">{query.data.length ? 'Нет маршрутов с выбранной активностью. Измените фильтр.' : 'В публичном каталоге маршрутов пока нет.'}</p>)}
    {op.editor && <Editor op={op} current={current} catalog={query.isSuccess ? query.data : undefined} available={query.isSuccess && !query.isFetching && Boolean(current)} restoreFocus={() => { restoreRequested.current = true; }} />}
  </section>;
}
