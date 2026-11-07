import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { checkpointPathId } from '../features/routes/model';
import type { Checkpoint, PublicRoute } from '../features/routes/model';
import { checkpointsError, checkpointsQuery, routesError, routesQuery } from '../features/routes/api';
import { sessionStore } from '../shared/session/store';
import { useCheckpointOperation } from '../features/adminCheckpoints/operation';
import { CheckpointEditor } from '../features/adminCheckpoints/Editor';
import { BatchEditor } from '../features/adminCheckpoints/batch/BatchEditor';
import { useBatchOperation } from '../features/adminCheckpoints/batch/operation';
import { batchEnabled } from '../features/adminCheckpoints/batch/model';
import styles from '../features/adminRoutes/AdminRoutes.module.css';
import local from '../features/adminCheckpoints/Checkpoints.module.css';

function Workspace({ route }: { route: PublicRoute }) {
  const query = useQuery(checkpointsQuery(route.id));
  const op = useCheckpointOperation(sessionStore.getCredentials()?.epoch ?? -1, route.id);
  const batch = useBatchOperation(sessionStore.getCredentials()?.epoch ?? -1, route.id);
  const opener = useRef<HTMLElement | null>(null), restoreRequested = useRef(false);
  useEffect(() => {
    if (!op.editor && !batch.state.visible && restoreRequested.current) {
      restoreRequested.current = false;
      const target = opener.current;
      (target?.isConnected && !(target instanceof HTMLButtonElement && target.disabled) ? target : document.getElementById('main'))?.focus();
    }
  }, [op.editor, batch.state.visible]);
  function open(kind: 'create' | 'edit' | 'delete', button: HTMLElement, point?: Checkpoint) { opener.current = button; op.open(kind, point); }
  return <><h1>КП маршрута</h1><p className={styles.intro}>{route.name} · ID {route.id} · {route.year} год · {route.distance} км</p><p className={styles.hint}>Здесь показаны опубликованные КП маршрута; список может быть неполным. Начальный и конечный КП не являются отметками прохождения участника.</p>
    <div className={styles.toolbar}><h2>Контрольные пункты</h2><button type="button" className={styles.secondary} disabled={query.isFetching || op.checking || Boolean(op.editor) || batch.state.visible} onClick={() => void op.check()}>Обновить КП</button><button type="button" className="primaryButton" disabled={Boolean(op.editor) || op.blocked('create') || batch.locked || batch.state.visible} onClick={event => open('create', event.currentTarget)}>Создать один КП</button>
      {batchEnabled() && <button type="button" className={styles.secondary} disabled={Boolean(op.editor) || op.blocked('create') || batch.state.visible || batch.locked} onClick={event => { opener.current = event.currentTarget; batch.open(); }}>Добавить несколько КП</button>}
      <Link to={`/routes/${route.id}`}>Публичный маршрут →</Link></div>
    {batch.locked && !batch.state.visible && <div className={styles.alert} role="status"><strong>Партия КП требует разбора. Новое создание этого маршрута заблокировано.</strong><p>В списке могут быть не все записи. Откройте проверку партии и сверьтесь с ответственным, чтобы избежать дублей.</p><button type="button" className={styles.secondary} disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; batch.open(); }}>Вернуться к проверке партии</button></div>}
    {op.paused.map((item, index) => <div className={styles.alert} role="status" key={index}><strong>Отложена операция с неизвестным исходом: {item.kind === 'delete' ? `удаление КП ${item.baseline?.id}` : item.kind === 'edit' ? `изменение КП ${item.baseline?.id}` : 'создание КП'}.</strong><p>Обновление списка не подтверждает исход операции. Сверьтесь с ответственным; повторное удаление этого КП заблокировано до выхода из аккаунта.</p><button type="button" className={styles.secondary} disabled={Boolean(op.editor)} onClick={event => { opener.current = event.currentTarget; op.resume(index); }}>Открыть проверку отложенной операции {index + 1}</button></div>)}
    {query.isPending && <p role="status">Загружаем КП маршрута…</p>}
    {query.isError && <div className={styles.panel} role="alert"><p>{checkpointsError(query.error)}</p><button type="button" className={styles.secondary} disabled={query.isFetching} onClick={() => void op.check()}>Повторить загрузку КП</button></div>}
    {query.isSuccess && (query.data.length ? <ul className={styles.list} aria-label="КП выбранного маршрута">{query.data.map(point => <li className={styles.panel} key={point.id}><p className={styles.hint}>КП ID {point.id} · ID маршрута {point.route_id} · порядок {point.order}</p><h3>{point.name}</h3><dl className={local.facts}><div><dt>Адрес</dt><dd>{point.address}</dd></div><div><dt>Координаты</dt><dd>{point.coordinates}</dd></div><div><dt>Начальный КП</dt><dd>{point.is_start ? 'Да' : 'Нет'}</dd></div><div><dt>Конечный КП</dt><dd>{point.is_finish ? 'Да' : 'Нет'}</dd></div></dl><div className={styles.actions}><button type="button" className={styles.secondary} disabled={Boolean(op.editor) || op.blocked('edit', point)} onClick={event => open('edit', event.currentTarget, point)}>Изменить КП<span className={styles.srOnly}> «{point.name}»</span></button><button type="button" className={styles.danger} disabled={Boolean(op.editor) || op.blocked('delete', point)} onClick={event => open('delete', event.currentTarget, point)}>Удалить КП<span className={styles.srOnly}> «{point.name}»</span></button></div></li>)}</ul> : <p className={styles.panel} role="status">В публичном списке этого маршрута КП пока нет.</p>)}
    {op.editor && <CheckpointEditor op={op} route={route} list={query.isSuccess ? query.data : undefined} onClose={() => { restoreRequested.current = true; }} />}
    {batch.state.visible && batchEnabled() && <BatchEditor op={batch} route={route} onClose={() => { restoreRequested.current = true; }} />}
  </>;
}
function RouteContext({ routeId }: { routeId: number }) {
  const query = useQuery(routesQuery);
  if (query.isPending) return <p role="status">Загружаем маршрут для КП…</p>;
  if (query.isError) return <div className={styles.panel} role="alert"><h1>Маршрут пока недоступен</h1><p>{routesError(query.error)}</p><button type="button" className={styles.secondary} disabled={query.isFetching} onClick={() => void query.refetch()}>Повторить загрузку маршрутов</button></div>;
  const route = query.data.find(item => item.id === routeId);
  return route ? <Workspace key={routeId} route={route} /> : <><h1>Маршрут недоступен в публичном каталоге</h1><p className={styles.intro}>Маршрут может быть скрыт из каталога. Уточните его доступность у ответственного.</p></>;
}
export function AdminCheckpointsPage() {
  const routeId = checkpointPathId(useLocation().pathname);
  return <section className={`container contentPage ${styles.workspace}`}><Link className={local.back} to="/staff/routes">← Управление маршрутами</Link>{routeId === null ? <><h1>Некорректный номер маршрута</h1><p className={styles.intro}>Откройте КП из управления маршрутами.</p></> : <RouteContext key={routeId} routeId={routeId} />}</section>;
}
