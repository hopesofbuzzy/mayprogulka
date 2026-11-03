import { useEffect, useId, useRef, useState } from 'react';
import type { PublicRoute } from '../../routes/model';
import { LogoutButton } from '../../auth/LogoutButton';
import { labels, names } from '../model';
import { bodyFor, unresolved } from './model';
import type { Row } from './model';
import type { useBatchOperation } from './operation';
import styles from '../../adminRoutes/AdminRoutes.module.css';
import local from './BatchEditor.module.css';

type Operation = ReturnType<typeof useBatchOperation>;
function Snapshot({ rows, routeId }: { rows: Row[]; routeId: number }) {
  const body = bodyFor(rows, routeId);
  return <ol className={local.rows}>{body.checkpoints.map((point, index) => <li className={styles.panel} key={rows[index]!.key}><h3>Строка {index + 1} — только номер в интерфейсе</h3><p>route_id {point.route_id}</p><dl className={styles.comparison}>{names.map(field => <div key={field}><dt>{labels[field]}</dt><dd>{typeof point[field] === 'boolean' ? point[field] ? 'Да' : 'Нет' : String(point[field])}</dd></div>)}</dl></li>)}</ol>;
}
function Confirmation({ routeId, resolving, disabled, onConfirm, count }: { routeId: number; resolving?: boolean; disabled: boolean; count: number; onConfirm: (typed: string, ack: boolean) => void }) {
  const [typed, setTyped] = useState(''), [ack, setAck] = useState(false), id = useId();
  return <div className={styles.review}>
    <label htmlFor={id}>Введите ID маршрута {routeId}</label><input id={id} autoComplete="off" value={typed} disabled={disabled} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
    <label className={styles.checkbox}><input type="checkbox" checked={ack} disabled={disabled} onChange={event => setAck(event.target.checked)} /><span>{resolving ? 'С ответственным разобрано вне приложения. Понимаю: приложение не доказало отсутствие дублей.' : 'Понимаю риск частичного создания и отсутствия безопасного автоповтора.'}</span></label>
    <button type="button" className="primaryButton" disabled={disabled || typed !== String(routeId) || !ack} onClick={() => onConfirm(typed, ack)}>{resolving ? 'Разобрано вне приложения' : `Создать ${count} КП`}</button>
  </div>;
}
export function BatchEditor({ op, route, onClose }: { op: Operation; route: PublicRoute; onClose: () => void }) {
  const { state } = op, id = useId(), dialog = useRef<HTMLDialogElement>(null), region = useRef<HTMLDivElement>(null);
  const previousMessage = useRef('');
  const previousRows = useRef(state.rows.map(row => row.key));
  const pending = state.phase === 'pending' || state.phase === 'checking', refreshing = state.refresh === 'pending';
  const result = state.phase === 'result', locked = unresolved(state), summary = state.summary;
  const close = () => { op.close(); onClose(); };
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    if ((state.phase === 'review' || state.phase === 'result') && region.current && dialog.current) {
      region.current.focus({ preventScroll: true });
      dialog.current.scrollTop = Math.max(0, region.current.offsetTop - 20);
    }
  }, [state.phase]);
  useEffect(() => {
    const before = previousRows.current, after = state.rows.map(row => row.key);
    if (state.phase === 'edit' && before.join('/') !== after.join('/')) {
      const added = after.find(key => !before.includes(key));
      document.getElementById(`${id}-${added ?? after[0]}-name`)?.focus();
    }
    previousRows.current = after;
  }, [state.rows, state.phase, id]);
  useEffect(() => {
    if (state.message && previousMessage.current !== state.message && state.phase === 'edit') {
      const row = state.rows.find(row => names.some(field => state.errors[row.key]?.[field]));
      const field = row && names.find(field => state.errors[row.key]?.[field]);
      if (row && field) document.getElementById(`${id}-${row.key}-${field}`)?.focus();
    }
    previousMessage.current = state.message;
  }, [state.message, state.phase, state.errors, state.rows, id]);
  return <dialog ref={dialog} className={`${styles.dialog} ${local.dialog}`} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.toolbar}><p className={styles.eyebrow}>Партия КП · mock only</p><button type="button" className={styles.secondary} onClick={close}>{pending || locked ? 'Отложить разбор / закрыть' : 'Закрыть партию'}</button><LogoutButton className={styles.secondary} /></div>
    <h2 id={`${id}-title`}>{result ? 'Результат партии КП' : state.phase === 'review' ? 'Проверка партии КП' : 'Добавить несколько КП'}</h2>
    <p className={styles.intro}>Маршрут: {route.name} · route_id {route.id}</p><p className={styles.alert}>Пакетное добавление может выполниться частично. Автоматического безопасного повтора нет. ID новых КП в ответе отсутствуют.</p>
    <p className={styles.hint}>Данные только в памяти текущей сессии. Перезагрузка или выход их удалят. Приложение не является журналом аудита.</p>
    {state.message && <p role="alert" className={styles.alert}>{state.message}</p>}
    {pending && <p role="status">{state.phase === 'checking' ? 'Перечитываем маршрут перед проверкой…' : 'Ожидаем ответ партии. Закрытие прерывает ожидание на устройстве, но не отменяет возможную запись.'}</p>}
    {result ? <div ref={region} tabIndex={-1} role="region" aria-label="Результат партии" className={styles.review}>
      {summary && <div role={locked ? 'alert' : 'status'} className={styles.alert}><strong>{summary.created_count === state.snapshot!.length && !summary.errors.length ? `Сервер сообщил о создании ${summary.created_count} из ${state.snapshot!.length} КП` : `Частичный или противоречивый результат: сервер сообщил о создании ${summary.created_count} из ${state.snapshot!.length}; сообщений в errors: ${summary.errors.length}`}</strong><p>Это отчёт сервера без ID и поимённого подтверждения строк. Число сообщений не равно числу неудачных строк.</p>{summary.errors.map((message, index) => <div className={local.message} key={index}><h3>Сообщение сервера №{index + 1}</h3><p>{message}</p></div>)}</div>}
      {state.unknown && <div role="alert" className={styles.alert}><strong>Исход партии неизвестен</strong><p>Сервер мог записать часть партии. Повтор этой партии не предоставляется.</p></div>}
      <p>Публичный GET может быть неполным. Наличие или отсутствие КП не доказывает, какие строки партии записаны. Не удаляйте и не создавайте предполагаемые дубли автоматически.</p>
      {refreshing ? <p role="status">Сверяем публичный список КП…</p> : <button type="button" className={styles.secondary} onClick={() => void op.refresh()}>Обновить список КП — только GET</button>}
      {state.refresh === 'error' && <p role="alert">{summary ? 'POST ответил; сверка списка не удалась.' : 'Сверка списка не удалась.'} Исходный отчёт сохранён, POST не повторяется.</p>}
      {state.refresh === 'success' && <p role="status">Публичный список КП перечитан. Это не устанавливает соответствие строкам партии.</p>}
      {state.snapshot && <details><summary>Снимок отправленной партии: {state.snapshot.length} строк</summary><Snapshot rows={state.snapshot} routeId={route.id} /></details>}
      {locked && <><p className={styles.alert}>Новое одиночное и пакетное создание этого маршрута заблокировано до разбора с ответственным. GET не снимает блокировку.</p><Confirmation key={op.confirmationRevision} resolving routeId={route.id} disabled={refreshing} count={0} onConfirm={op.resolve} /></>}
      {state.resolved && <p role="status">Отмечено как разобранное вне приложения. Снята только локальная блокировка; отсутствие дублей приложением не доказано.</p>}
      {!locked && <button type="button" className={styles.secondary} disabled={refreshing} onClick={op.startNew}>Начать новую пустую партию</button>}
    </div> : state.phase === 'review' ? <div ref={region} tabIndex={-1} role="region" aria-label="Проверка партии" className={styles.review}>
      <h3>К отправке: {state.snapshot!.length} строк · route_id {route.id}</h3><p>Проверьте названия и order на возможные дубли. Порядок строк не менялся; серверная уникальность неизвестна.</p><Snapshot rows={state.snapshot!} routeId={route.id} />
      <Confirmation key={op.confirmationRevision} routeId={route.id} disabled={pending} count={state.snapshot!.length} onConfirm={(typed, ack) => void op.confirm(typed, ack)} />
      <button type="button" className={styles.secondary} onClick={op.back}>Вернуться к строкам</button>
    </div> : <form className={styles.form} onSubmit={event => event.preventDefault()} noValidate aria-busy={pending}><div className={local.rows}>{state.rows.map((row, index) => <fieldset key={row.key} className={styles.panel} disabled={pending}><legend>Строка {index + 1} — номер в интерфейсе</legend><p className={styles.hint}>route_id {route.id} · фиксирован для строки</p><div className={styles.fields}>{names.map(field => <div key={field} className={field === 'coordinates' || field === 'address' ? styles.full : ''}>
      {typeof row.values[field] === 'boolean' ? <label className={styles.checkbox}><input type="checkbox" checked={Boolean(row.values[field])} onChange={event => op.change(row.key, field, event.target.checked)} />{labels[field]}</label> : <><label htmlFor={`${id}-${row.key}-${field}`}>{labels[field]}</label><input type="text" id={`${id}-${row.key}-${field}`} value={String(row.values[field])} required autoComplete="off" spellCheck={false} aria-invalid={Boolean(state.errors[row.key]?.[field])} aria-describedby={state.errors[row.key]?.[field] ? `${id}-${row.key}-${field}-error` : undefined} onChange={event => op.change(row.key, field, event.target.value)} /></>}
      {state.errors[row.key]?.[field] && <p className={styles.error} id={`${id}-${row.key}-${field}-error`}>{state.errors[row.key]?.[field]}</p>}
    </div>)}</div><button type="button" className={styles.secondary} disabled={state.rows.length <= 1} onClick={() => op.remove(row.key)}>Удалить строку {index + 1}</button></fieldset>)}</div><p className={styles.hint}>Координаты — непреобразованная строка. Order — целое число без заданного диапазона, вводится вручную. Флаги независимы.</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={pending} onClick={op.add}>Добавить строку</button><button type="button" className="primaryButton" disabled={pending} onClick={() => void op.review()}>Проверить перед отправкой</button></div></form>}
  </dialog>;
}
