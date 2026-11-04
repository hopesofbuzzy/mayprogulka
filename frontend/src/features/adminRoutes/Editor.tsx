import { useEffect, useId, useRef, useState } from 'react';
import { LogoutButton } from '../auth/LogoutButton';
import { routeFields, updateBody, labels } from './model';
import type { Fields } from './model';
import type { useAdminOperation } from './operation';
import type { PublicRoute } from '../routes/model';
import styles from './AdminRoutes.module.css';

type Operation = ReturnType<typeof useAdminOperation>;
const show = (value: unknown) => typeof value === 'boolean' ? value ? 'Да' : 'Нет' : value === '' || value === null || value === undefined ? 'Не указано' : String(value);
export function Editor({ op, current, catalog, available, restoreFocus }: { op: Operation; current?: PublicRoute; catalog?: PublicRoute[]; available: boolean; restoreFocus: () => void }) {
  const editor = op.editor!;
  const dialog = useRef<HTMLDialogElement>(null), review = useRef<HTMLDivElement>(null);
  const [typedId, setTypedId] = useState('');
  const id = useId();
  const busy = editor.phase === 'pending', confirmed = editor.phase === 'confirmed';
  const canClose = !busy && !editor.uncertain && editor.refresh !== 'pending';
  const close = () => { if (canClose) { op.close(); restoreFocus(); } };
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (editor.phase === 'review' || confirmed) review.current?.focus(); }, [editor.phase, confirmed]);
  useEffect(() => {
    const field = Object.keys(editor.errors)[0];
    if (field && editor.phase === 'edit') document.getElementById(`${id}-${field}`)?.focus();
  }, [editor.errors, editor.phase, id]);
  const title = confirmed ? editor.kind === 'create' ? 'Создание подтверждено' : editor.kind === 'edit' ? 'Изменение подтверждено' : 'Сервер подтвердил операцию'
    : editor.kind === 'create' ? 'Новый маршрут' : editor.kind === 'edit' ? 'Редактирование маршрута' : 'Подтверждение удаления';
  const fieldNames = (Object.keys(labels) as (keyof Fields)[]).filter(field => editor.kind === 'create' || field !== 'year');
  const changes = editor.kind === 'create' ? fieldNames : Object.keys(updateBody(editor.values, editor.baseline!)) as (keyof Fields)[];
  const before = editor.baseline ? routeFields(editor.baseline) : undefined;
  const concurrent = current && editor.baseline && (['id', 'year', 'name', 'distance', 'description', 'is_active', 'map_url'] as const).some(field => current[field] !== editor.baseline![field]);
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} className={styles.dialog} onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.toolbar}><p className={styles.eyebrow}>Управление маршрутами</p><button type="button" className={styles.secondary} disabled={!canClose} onClick={close}>Закрыть</button><LogoutButton className={styles.secondary} /></div>
    <h2 id={`${id}-title`}>{title}</h2>
    {editor.baseline && <p className={styles.intro}>Маршрут: {editor.baseline.name} · ID {editor.baseline.id} · {editor.baseline.year} год</p>}
    {editor.message && <div className={styles.alert} role="alert">{editor.message}</div>}
    {editor.uncertain && <div className={styles.alert} role="alert"><strong>Исход предыдущей операции неизвестен.</strong><p>Список может быть неполным. Даже если маршрут не виден, запись могла сохраниться. Перед дальнейшими действиями сверьтесь с ответственным.</p>
      <button className={styles.secondary} type="button" disabled={op.checking || busy} onClick={() => void op.check()}>{op.checking ? 'Проверяем каталог…' : 'Проверить состояние в каталоге'}</button>
      {op.checked && <p>Список обновлён, но результат операции нужно сверить с ответственным.</p>}
      {op.checked && (catalog ? <details><summary>Просмотреть полученный каталог для сверки</summary><ul aria-label="Каталог для сверки">{catalog.map(route => <li key={route.id}>{route.name} · ID {route.id} · {route.year} год · {route.distance} км · Активность: {route.is_active ? 'Да' : 'Нет'}</li>)}</ul>{!catalog.length && <p>Получен пустой публичный список. Это не доказывает отсутствие записи.</p>}</details> : <p role="status">Перечитать каталог не удалось. Проверьте результат с ответственным; сведения из списка сейчас недостоверны.</p>)}
      {editor.kind !== 'delete' && <label className={styles.checkbox}><input type="checkbox" disabled={!op.checked || op.checking || busy} checked={op.acknowledged} onChange={event => op.setAcknowledged(event.target.checked)} /><span>Я сверил ситуацию с ответственным и понимаю риск повторной операции и дубля.</span></label>}
      {editor.kind === 'delete' && <p>Повторное удаление здесь недоступно. Нужна проверка ответственным.</p>}
    </div>}
    {confirmed ? <div ref={review} tabIndex={-1} className={styles.review} role="region" aria-label="Результат операции">
      {editor.result && <p>Сохранённая запись: {editor.result.name} · ID {editor.result.id} · {editor.result.year} год · {editor.result.distance} км.</p>}
      {editor.kind === 'delete' && <p>Результат в публичном каталоге требует проверки. Не установлено, удалил ли сервер запись или перевёл её в архив.</p>}
      {editor.refresh === 'pending' && <p role="status">Обновляем список после подтверждённой операции…</p>}
      {editor.refresh === 'error' && <div role="alert"><p>Операция подтверждена, но обновление списка не удалось.</p><button type="button" className={styles.secondary} disabled={op.checking} onClick={() => void op.check()}>Перечитать каталог</button></div>}
      {editor.refresh === 'success' && <><p>Каталог перечитан с сервера.</p>{editor.kind === 'create' && !available && <p>Созданный маршрут не появился в публичном каталоге. Это не опровергает подтверждённое создание.</p>}{editor.kind === 'delete' && available && <p>Удаление подтверждено, но маршрут всё ещё виден. Сверьтесь с ответственным; не удаляйте его повторно.</p>}</>}
      {editor.earlierUncertain && <p className={styles.alert}>Ранее была операция без подтверждения. Возможный дубль или повторное изменение требует отдельной проверки.</p>}
    </div> : editor.kind === 'delete' ? <div className={styles.review}>
      <p>Не известно, полностью ли сервер удаляет маршрут или переводит в архив; действие может затронуть связанные данные.</p>
      {!editor.uncertain && <><label htmlFor={`${id}-confirm`}>Для подтверждения введите ID {editor.baseline!.id}</label><input id={`${id}-confirm`} value={typedId} disabled={busy} autoComplete="off" inputMode="numeric" onChange={event => setTypedId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
        <button type="button" className={styles.danger} disabled={busy || !available || typedId !== String(editor.baseline!.id)} onClick={() => void op.confirm(typedId, available)}>Подтвердить удаление</button></>}
    </div> : editor.phase === 'review' ? <div ref={review} tabIndex={-1} className={styles.review} role="region" aria-label="Проверка маршрута">
      <h3>Проверьте данные перед отправкой</h3><dl className={styles.comparison}>{changes.map(field => <div key={field}><dt>{labels[field]}</dt><dd>{before ? <><span>Было: {show(before[field])}</span><span>Станет: {show(editor.values[field])}</span></> : show(editor.values[field])}</dd></div>)}</dl>
      <div className={styles.actions}><button type="button" className="primaryButton" disabled={busy || op.checking || (editor.kind !== 'create' && !available) || (editor.uncertain && !op.acknowledged)} onClick={() => void op.confirm('', available)}>Подтвердить {editor.kind === 'create' ? 'создание' : 'изменения'}</button><button type="button" className={styles.secondary} onClick={op.back}>Вернуться к вводу</button></div>
    </div> : <form className={styles.form} onSubmit={event => event.preventDefault()} noValidate aria-busy={busy}>
      {editor.kind === 'edit' && <p>Год: {editor.baseline!.year}. Год и схему маршрута здесь изменить нельзя.</p>}
      <fieldset disabled={busy}><legend className={styles.srOnly}>Поля маршрута</legend><div className={styles.fields}>
        {fieldNames.map(field => <div className={field === 'description' ? styles.full : ''} key={field}>
          {field === 'is_active' ? <label className={styles.checkbox}><input id={`${id}-${field}`} type="checkbox" aria-invalid={Boolean(editor.errors[field])} aria-describedby={editor.errors[field] ? `${id}-${field}-error` : undefined} checked={editor.values.is_active} onChange={event => op.change(field, event.target.checked)} />{labels[field]}</label> : <><label htmlFor={`${id}-${field}`}>{labels[field]}</label>{field === 'description' ? <textarea id={`${id}-${field}`} value={editor.values[field]} onChange={event => op.change(field, event.target.value)} aria-invalid={Boolean(editor.errors[field])} aria-describedby={editor.errors[field] ? `${id}-${field}-error` : undefined} /> : <input id={`${id}-${field}`} type="text" inputMode={field === 'year' ? 'numeric' : field === 'distance' ? 'decimal' : 'text'} required value={editor.values[field]} onChange={event => op.change(field, event.target.value)} aria-invalid={Boolean(editor.errors[field])} aria-describedby={editor.errors[field] ? `${id}-${field}-error` : undefined} />}</>}
          {editor.errors[field] && <p className={styles.error} id={`${id}-${field}-error`}>{editor.errors[field]}</p>}
        </div>)}
      </div></fieldset><p className={styles.hint}>Активность не означает открытие регистрации. Пустое описание при редактировании явно очищает его; остальные поля не стираются.</p>
      <button type="button" className="primaryButton" disabled={busy || op.checking || (editor.uncertain && !op.acknowledged)} onClick={op.review}>Проверить данные</button>
    </form>}
    {!confirmed && editor.kind !== 'create' && <><p className={styles.hint}>Другой сотрудник мог изменить маршрут. Перед подтверждением обновите данные.</p>{concurrent && <p className={styles.alert} role="status">Маршрут изменился. Сверьте свою правку с текущей карточкой: изменения разных сотрудников не объединяются автоматически.</p>}{!available && <p className={styles.alert}>Маршрут сейчас не найден в списке. Действие заблокировано до проверки данных.</p>}<button className={styles.secondary} type="button" disabled={busy || op.checking} onClick={() => void op.check()}>Перечитать данные маршрутов</button></>}
    {busy && <p role="status" className={styles.intro}>Ждём подтверждение сервера… Автоматического повтора нет.</p>}
  </dialog>;
}
