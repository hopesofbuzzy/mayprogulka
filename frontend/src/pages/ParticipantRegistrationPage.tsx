import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/AuthProvider';
import { routesQuery } from '../features/routes/api';
import { myParticipantsOptions, registerParticipants, RegistrationFailure, useMyParticipants } from '../features/participants/api';
import { emptyRow, fieldNames, indexedErrors, labels, paymentLabel, registrationBody, validateRows } from '../features/participants/model';
import type { FieldName, Registration, RowErrors } from '../features/participants/model';
import { ParticipantsFailure, ParticipantsList } from '../features/participants/ParticipantsView';
import { StaleSessionError } from '../shared/api/errors';
import { sessionStore } from '../shared/session/store';
import styles from '../features/participants/Participants.module.css';

function RegistrationForm({ epoch }: { epoch: number }) {
  const [rows, setRows] = useState(() => [emptyRow('row-1')]);
  const [errors, setErrors] = useState<RowErrors>({});
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Registration | null>(null);
  const [listRefresh, setListRefresh] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [checking, setChecking] = useState(false);
  const nextKey = useRef(2);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const id = useId();
  const client = useQueryClient();
  const routes = useQuery(routesQuery);
  const mine = useMyParticipants(false);
  const activeRoutes = routes.data?.filter(route => route.is_active === true) ?? [];
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (message) summary.current?.focus(); }, [message]);

  function focusField(key: string, name: FieldName = 'surname') {
    requestAnimationFrame(() => document.getElementById(`${id}-${key}-${name}`)?.focus());
  }
  function change(key: string, name: FieldName, value: string) {
    if (busy.current) return;
    setRows(current => current.map(row => row.key === key ? { ...row, values: { ...row.values, [name]: value } } : row));
    setErrors(current => { const next = { ...current, [key]: { ...current[key] } }; delete next[key]![name]; return next; });
    setAcknowledged(false);
  }
  function addRow() {
    if (busy.current) return;
    const key = `row-${nextKey.current++}`;
    setRows(current => [...current, emptyRow(key)]);
    setAcknowledged(false);
    focusField(key);
  }
  function removeRow(key: string) {
    if (busy.current || rows.length <= 1) return;
    const remaining = rows.filter(row => row.key !== key);
    setRows(remaining);
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setAcknowledged(false);
    if (remaining[0]) focusField(remaining[0].key);
  }
  async function refreshAfterSuccess() {
    if (!sessionStore.isCurrentSession(epoch)) return;
    setListRefresh('pending');
    const options = myParticipantsOptions(epoch);
    // A review GET started before the POST must not become the post-201 refresh.
    await client.cancelQueries({ queryKey: options.queryKey, exact: true });
    if (!sessionStore.isCurrentSession(epoch)) return;
    await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: 'none' });
    if (!sessionStore.isCurrentSession(epoch)) return;
    try {
      await client.fetchQuery({ ...options, staleTime: 0 });
      if (sessionStore.isCurrentSession(epoch) && !controller.current?.signal.aborted) setListRefresh('success');
    } catch {
      if (sessionStore.isCurrentSession(epoch) && !controller.current?.signal.aborted) setListRefresh('error');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || (uncertain && !acknowledged)) return;
    if (!rows.length || !routes.isSuccess || routes.isFetching || !activeRoutes.length) { setMessage('Для регистрации нужен загруженный список доступных маршрутов.'); return; }
    const validation = validateRows(rows, routes.data);
    setErrors(validation);
    const firstKey = rows.find(row => Object.keys(validation[row.key] ?? {}).length)?.key;
    if (firstKey) {
      setMessage('Проверьте поля участников.');
      const name = fieldNames.find(field => validation[firstKey]?.[field]);
      focusField(firstKey, name);
      return;
    }
    setMessage('');
    busy.current = true;
    setPending(true);
    const request = new AbortController();
    controller.current = request;
    const submittedKeys = rows.map(row => row.key);
    try {
      const data = await registerParticipants(registrationBody(rows).participants, epoch, request.signal);
      setConfirmation(data);
      setErrors({});
      await refreshAfterSuccess();
    } catch (error) {
      if (!(error instanceof StaleSessionError) && !request.signal.aborted && sessionStore.isCurrentSession(epoch)) {
        const failure = error instanceof RegistrationFailure ? error : new RegistrationFailure('Не удалось получить подтверждение. Участники могли быть зарегистрированы.', true);
        setMessage(failure.message);
        setErrors(indexedErrors(failure.details, submittedKeys));
        if (failure.uncertain) setUncertain(true);
        setAcknowledged(false);
      }
    } finally {
      busy.current = false;
      if (!request.signal.aborted && sessionStore.isCurrentSession(epoch)) setPending(false);
    }
  }

  const countMismatch = confirmation !== null && confirmation.participants.length !== rows.length;
  if (confirmation) return <section className="container contentPage">
    <h1>{countMismatch ? 'Регистрация требует проверки' : 'Регистрация подтверждена'}</h1>
    <div className={styles.confirmation}>
      <h2>Номер операции: {confirmation.registration_id}</h2>
      {countMismatch && <div className={styles.alert} role="alert">
        <strong>Количество участников в ответе отличается от отправленного списка.</strong>
        <p>Отправлено участников: {rows.length}. В подтверждении сервера: {confirmation.participants.length}.</p>
        <p>Регистрация всего отправленного списка не подтверждена. Проверьте участников в личном кабинете. Не отправляйте форму повторно: это может создать дубликаты.</p>
      </div>}
      <p>У каждого участника — отдельный номер анкеты. Номер операции не заменяет номер анкеты.</p>
      <ul className={styles.resultList} aria-label="Созданные участники">{confirmation.participants.map(participant => <li key={participant.id}>
        <strong>{participant.surname} {participant.name}</strong><span>Номер участника: {participant.id}</span><span>Номер анкеты: {participant.form_id}</span><span>{paymentLabel(participant.payment_status)}</span>
        <Link className={styles.textLink} to={`/account/participants/${participant.id}`}>Карточка участника</Link>
      </li>)}</ul>
      {uncertain && <p>Ранее была отправка без подтверждения. Проверьте список на возможные дубли.</p>}
      {listRefresh === 'pending' && <p role="status">{countMismatch ? 'Обновляем список участников…' : 'Регистрация подтверждена. Обновляем список участников…'}</p>}
      {listRefresh === 'error' && <div role="alert"><p>{countMismatch ? 'Ответ сервера получен, но список пока не удалось обновить.' : 'Создание подтверждено сервером, но список пока не удалось обновить.'} Не отправляйте регистрацию повторно.</p><button className={styles.secondary} type="button" onClick={() => void refreshAfterSuccess()}>Повторить загрузку списка</button></div>}
      {listRefresh === 'success' && <p role="status">Список участников обновлён по данным сервера.</p>}
      <div className={styles.actions}><Link className="primaryButton" to="/account">В личный кабинет</Link></div>
    </div>
  </section>;

  return <section className="container contentPage" aria-labelledby={`${id}-title`}>
    <Link className={styles.back} to="/account">← В личный кабинет</Link>
    <h1 id={`${id}-title`}>Добавить участников</h1>
    <p className="intro">Можно зарегистрировать себя и близких. Для каждого выберите маршрут и заполните отдельную анкету.</p>
    <form className={styles.form} noValidate onSubmit={event => { void submit(event); }} aria-busy={pending}>
      {message && !uncertain && <div ref={summary} tabIndex={-1} className={styles.alert} role="alert">{message}</div>}
      {uncertain && <div ref={summary} tabIndex={-1} className={styles.alert} role="alert">
        {message && <strong>{message}</strong>}
        <p>Результат предыдущей отправки неизвестен.</p>
        <p>Сначала проверьте своих участников. Даже отсутствие записи в списке не гарантирует, что регистрация не сохранилась.</p>
        <button type="button" className={styles.secondary} disabled={pending || mine.isFetching} onClick={() => { setChecking(true); void mine.refetch(); }}>Проверить в личном кабинете</button>
        <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} /><span>Понимаю, что повторная отправка может создать дубликаты, и хочу отправить форму ещё раз.</span></label>
      </div>}
      {checking && <div className={styles.state} aria-label="Проверка своих участников">
        <h2>Проверка по данным личного кабинета</h2>
        {mine.isFetching ? <p role="status">Проверяем список участников…</p>
          : mine.isError ? <ParticipantsFailure error={mine.error} pending={mine.isFetching} retry={() => void mine.refetch()} />
            : mine.data && (mine.data.length ? <ParticipantsList participants={mine.data} /> : <p>Список сейчас пуст. Это не доказывает, что предыдущая отправка не сохранилась.</p>)}
      </div>}
      {routes.isPending && <p role="status" className={styles.note}>Загружаем маршруты…</p>}
      {routes.isError && <div className={styles.alert} role="alert">Не удалось загрузить маршруты. Личные данные сохранены.<br /><button type="button" className={styles.secondary} onClick={() => void routes.refetch()} disabled={routes.isFetching}>Повторить загрузку маршрутов</button></div>}
      {routes.isSuccess && !activeRoutes.length && <p className={styles.alert} role="status">Доступных маршрутов пока нет. Регистрацию отправить нельзя.</p>}
      <p className={styles.note}>Условия участия и открытие регистрации уточните у организаторов. Год маршрута не определяет дату прогулки.</p>
      <button type="button" className={styles.secondary} onClick={() => void routes.refetch()} disabled={pending || routes.isFetching}>Обновить маршруты</button>
      <div className={styles.rows}>{rows.map((row, index) => <fieldset className={styles.row} key={row.key} disabled={pending}>
        <legend>Участник {index + 1}</legend>
        <div className={styles.rowHeader}><button type="button" className={styles.secondary} disabled={pending || rows.length === 1} onClick={() => removeRow(row.key)} aria-label={`Убрать участника ${index + 1}`}>Убрать</button></div>
        <div className={styles.fields}>{fieldNames.map(name => {
          const fieldId = `${id}-${row.key}-${name}`;
          const issue = errors[row.key]?.[name];
          const selectedRoute = name === 'route_id' ? activeRoutes.find(route => route.id === Number(row.values.route_id)) : undefined;
          const unavailableRoute = name === 'route_id' && row.values.route_id && !activeRoutes.some(route => route.id === Number(row.values.route_id));
          const common = { id: fieldId, name, value: row.values[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => change(row.key, name, event.target.value), 'aria-invalid': Boolean(issue || unavailableRoute), 'aria-describedby': [issue ? `${fieldId}-error` : unavailableRoute ? `${fieldId}-unavailable` : '', selectedRoute ? `${fieldId}-selected` : ''].filter(Boolean).join(' ') || undefined, required: name !== 'middle_name' };
          return <div className={styles.field} key={name}>
            <label htmlFor={fieldId}>{labels[name]}</label>
            {name === 'route_id' ? <select {...common} disabled={pending || !activeRoutes.length || routes.isError}>
              <option value="">Выберите маршрут</option>
              {unavailableRoute && <option value={row.values.route_id} disabled>Выбранный маршрут больше недоступен</option>}
              {activeRoutes.map(route => <option key={route.id} value={route.id}>{route.name} · {route.year} · {route.distance} км</option>)}
            </select> : name === 'gender' ? <select {...common}><option value="">Выберите пол</option><option value="male">Мужской</option><option value="female">Женский</option></select>
              : <input {...common} type={name === 'date_of_birth' ? 'date' : name === 'email' ? 'email' : name === 'phone_number' ? 'tel' : 'text'} />}
            {issue && <p className={styles.fieldError} id={`${fieldId}-error`}>{issue}</p>}
            {selectedRoute && <p className={styles.fieldHint} id={`${fieldId}-selected`}>{selectedRoute.name} · {selectedRoute.year} год · {selectedRoute.distance} км</p>}
            {unavailableRoute && !issue && <p className={styles.fieldError} id={`${fieldId}-unavailable`}>Выбранный маршрут недоступен. Выберите другой.</p>}
          </div>;
        })}</div>
      </fieldset>)}</div>
      <div className={styles.actions}>
        <button className={styles.secondary} type="button" disabled={pending} onClick={addRow}>Добавить ещё участника</button>
        <button className={styles.submit} type="submit" disabled={pending || !routes.isSuccess || routes.isFetching || !activeRoutes.length || (uncertain && !acknowledged)}>{pending ? 'Отправляем…' : uncertain ? 'Повторить отправку с риском дублирования' : 'Зарегистрировать участников'}</button>
      </div>
      {pending && <p role="status" className={styles.progress}>Ждём подтверждение регистрации…</p>}
    </form>
  </section>;
}

export function ParticipantRegistrationPage() {
  const { isAuthenticated } = useAuth();
  const epoch = sessionStore.getCredentials()?.epoch;
  return isAuthenticated && epoch !== undefined ? <RegistrationForm key={epoch} epoch={epoch} /> : null;
}
