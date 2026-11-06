import { useEffect, useId, useRef, useState } from 'react';
import type { Checkpoint, PublicRoute } from '../routes/model';
import { useValidationFocus } from '../adminShared/useValidationFocus';
import { labels, names, pointFields, rebaseValues, samePoint, updateBody, validCoordinates } from './model';
import type { useCheckpointOperation } from './operation';
import styles from '../adminRoutes/AdminRoutes.module.css';
import local from './Checkpoints.module.css';

type Operation = ReturnType<typeof useCheckpointOperation>;
const show = (value: unknown) => typeof value === 'boolean' ? value ? 'Да' : 'Нет' : String(value ?? '');
export function CheckpointEditor({ op, route, list, onClose }: { op: Operation; route: PublicRoute; list?: Checkpoint[]; onClose: () => void }) {
  const editor = op.editor!, id = useId();
  const dialog = useRef<HTMLDialogElement>(null), review = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<{ baseline?: Checkpoint; value: string }>({ value: '' });
  const typedId = typed.baseline === editor.baseline ? typed.value : '';
  const setTypedId = (value: string) => setTyped({ baseline: editor.baseline, value });
  const pending = editor.phase === 'pending', confirmed = editor.phase === 'confirmed';
  const current = list?.find(point => point.id === (editor.result?.id ?? editor.baseline?.id));
  const stale = Boolean(editor.baseline && current && !samePoint(current, editor.baseline));
  const available = Boolean(current), canConfirm = editor.kind === 'create' || (available && !stale);
  const close = () => { if (editor.refresh !== 'pending') { op.close(); onClose(); } };
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (editor.phase === 'review' || confirmed) review.current?.focus(); }, [editor.phase, confirmed]);
  const invalidField = names.find(name => Boolean(editor.errors[name]));
  useValidationFocus(editor.focusRevision ?? 0, editor.phase === 'edit' && invalidField ? `${id}-${invalidField}` : undefined);
  const title = confirmed ? editor.kind === 'create' ? 'Создание КП подтверждено' : editor.kind === 'edit' ? 'Изменение КП подтверждено' : 'Операция удаления КП подтверждена'
    : editor.kind === 'create' ? 'Новый контрольный пункт' : editor.kind === 'edit' ? 'Редактирование КП' : 'Подтверждение удаления КП';
  const changed = editor.kind === 'create' ? names : editor.baseline ? Object.keys(updateBody(editor.values, editor.baseline)) as typeof names : [];
  const before = editor.baseline ? pointFields(editor.baseline) : undefined;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.toolbar}><p className={styles.eyebrow}>Контрольные пункты</p><button type="button" className={styles.secondary} disabled={editor.refresh === 'pending'} onClick={close}>{editor.uncertain || pending ? 'Закрыть и разобраться позже' : 'Закрыть'}</button></div>
    <h2 id={`${id}-title`}>{title}</h2><p className={styles.intro}>Маршрут: {route.name} · ID маршрута {route.id}</p>
    {editor.baseline && <p className={styles.intro}>КП: {editor.baseline.name} · ID КП {editor.baseline.id}</p>}
    {editor.kind === 'edit' && editor.baseline && !validCoordinates(editor.baseline.coordinates) && <p className={styles.hint}>Сохранённые координаты имеют прежний формат. Можно изменить другие поля, сохранив эту строку. Новые координаты вводите в формате WGS84.</p>}
    {editor.message && <p role="alert" className={styles.alert}>{editor.message}</p>}
    {editor.uncertain && <div role="alert" className={styles.alert}><strong>Исход операции неизвестен</strong><p>В списке могут быть не все КП. Запись могла сохраниться, даже если её не видно. Перед дальнейшими действиями сверьтесь с ответственным.</p>
      <button type="button" className={styles.secondary} disabled={op.checking} onClick={() => void op.check()}>Проверить список КП</button>
      {op.checked && (list ? <details><summary>Просмотреть перечитанный список</summary><ul>{list.map(point => <li key={point.id}>{point.name} · ID {point.id} · порядок {point.order} · {point.coordinates}</li>)}</ul>{!list.length && <p>Список пуст, но операция могла сохраниться. Сверьтесь с ответственным.</p>}</details> : <p>Перечитать список не удалось. Нужна проверка ответственным.</p>)}
      {editor.kind === 'delete' ? <p>Повторное удаление этого КП недоступно.</p> : <label className={styles.checkbox}><input type="checkbox" disabled={!op.checked || op.checking} checked={op.acknowledged} onChange={event => op.setAcknowledged(event.target.checked)} /><span>Я проверил с ответственным и понимаю риск повторного изменения или дубля.</span></label>}
    </div>}
    {confirmed ? <div ref={review} tabIndex={-1} role="region" aria-label="Результат операции с КП" className={styles.review}>
      {editor.result && <p>Сохранённая запись: {editor.result.name} · ID {editor.result.id} · ID маршрута {editor.result.route_id}.</p>}
      {editor.refresh === 'pending' && <p role="status">Перечитываем КП маршрута…</p>}
      {editor.refresh === 'error' && <div role="alert"><p>Операция с КП подтверждена, но перечитать список не удалось.</p><button type="button" className={styles.secondary} disabled={op.checking} onClick={() => void op.check()}>Повторить обновление списка КП</button></div>}
      {editor.refresh === 'success' && <><p>Список КП обновлён.</p>{editor.kind === 'create' && !available && <p>Созданный КП не виден в публичной выборке. Это не опровергает подтверждённое создание.</p>}{editor.kind === 'delete' && available && <p>Удаление подтверждено, но КП всё ещё виден. Сверьтесь с ответственным; не удаляйте его повторно.</p>}</>}
      {editor.earlierUncertain && <p className={styles.alert}>Предыдущий неизвестный результат всё ещё требует проверки на возможный дубль или повтор.</p>}
    </div> : <>
      {editor.baseline && <><p className={styles.hint}>Другой сотрудник мог изменить КП. Перед отправкой обновите данные.</p>{(!available || stale) && <div role="status" className={styles.alert}>КП изменился, исчез из списка или список недоступен. Отправка заблокирована: обновите данные и сверьте свою правку.</div>}
        <button type="button" className={styles.secondary} disabled={pending || op.checking} onClick={() => void op.check()}>Перечитать КП перед действием</button>
        {stale && current && <div className={styles.alert}><p>Текущая запись: {current.name} · {current.address} · {current.coordinates} · порядок {current.order} · начальный: {show(current.is_start)} · конечный: {show(current.is_finish)}</p><button type="button" className={styles.secondary} disabled={!op.checked || op.checking || pending} onClick={() => op.rebase(current, rebaseValues(editor.values, editor.baseline!, current))}>Использовать обновлённые данные, сохранив мою правку</button></div>}
      </>}
      {editor.kind === 'delete' ? <div className={styles.review}><p>Сервер может отказать при наличии отметок прохождения. Последствия удаления и сохранность истории требуют согласования.</p>{!editor.uncertain && <><label htmlFor={`${id}-delete`}>Введите ID КП {editor.baseline!.id}</label><input id={`${id}-delete`} type="text" autoComplete="off" value={typedId} disabled={pending} onChange={event => setTypedId(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /><button type="button" className={styles.danger} disabled={pending || !canConfirm || typedId !== String(editor.baseline!.id)} onClick={() => void op.confirm(typedId, available)}>Подтвердить удаление КП</button></>}</div>
        : editor.phase === 'review' ? <div className={styles.review} ref={review} tabIndex={-1} role="region" aria-label="Проверка КП"><h3>Проверьте значения КП</h3><dl className={styles.comparison}>{changed.map(field => <div key={field}><dt>{labels[field]}</dt><dd>{before ? <><span>Было: {show(before[field])}</span><span>Станет: {show(editor.values[field])}</span></> : show(editor.values[field])}</dd></div>)}</dl><div className={styles.actions}><button type="button" className="primaryButton" disabled={!canConfirm || op.checking || (editor.uncertain && !op.acknowledged)} onClick={() => void op.confirm('', available)}>Подтвердить {editor.kind === 'create' ? 'создание КП' : 'изменения КП'}</button><button type="button" className={styles.secondary} onClick={op.back}>Вернуться к полям КП</button></div></div>
          : <form className={styles.form} onSubmit={event => event.preventDefault()} noValidate aria-busy={pending}><fieldset disabled={pending}><legend className={styles.srOnly}>Поля КП</legend><div className={styles.fields}>{names.map(field => <div className={field === 'coordinates' || field === 'address' ? styles.full : ''} key={field}>
            {typeof editor.values[field] === 'boolean' ? <label className={styles.checkbox}><input id={`${id}-${field}`} type="checkbox" checked={Boolean(editor.values[field])} aria-invalid={Boolean(editor.errors[field])} aria-describedby={editor.errors[field] ? `${id}-${field}-error` : undefined} onChange={event => op.change(field, event.target.checked)} />{labels[field]}</label> : <><label htmlFor={`${id}-${field}`}>{labels[field]}</label><input id={`${id}-${field}`} type="text" value={String(editor.values[field])} required autoComplete="off" spellCheck={false} aria-invalid={Boolean(editor.errors[field])} aria-describedby={editor.errors[field] ? `${id}-${field}-error` : undefined} onChange={event => op.change(field, event.target.value)} /></>}
            {editor.errors[field] && <p className={styles.error} id={`${id}-${field}-error`}>{editor.errors[field]}</p>}
          </div>)}</div></fieldset><p className={styles.hint}>Координаты WGS84: широта, долгота (например, 56.83, 60.60). Порядок прохождения задайте целым числом; старт и финиш отмечаются независимо.</p><button type="button" className="primaryButton" disabled={pending || op.checking || (editor.uncertain && !op.acknowledged)} onClick={op.review}>Проверить данные КП</button></form>}
    </>}
    {pending && <p role="status" className={local.notice}>Ожидаем сервер. Закрытие прерывает ожидание на устройстве, но не отменяет возможную запись.</p>}
  </dialog>;
}
