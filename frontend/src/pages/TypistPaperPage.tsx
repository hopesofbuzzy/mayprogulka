import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { routesQuery } from '../features/routes/api';
import { fieldNames, labels } from '../features/participants/model';
import { createPaper } from '../features/typist/api';
import { emptyPaper, paperBody, validatePaper } from '../features/typist/model';
import { useStaffOperation } from '../features/typist/operation';
import { OperationNotice } from '../features/typist/OperationNotice';
import { sessionStore } from '../shared/session/store';
import styles from '../features/typist/Typist.module.css';
import common from '../features/participants/Participants.module.css';

export function TypistPaperPage() {
  const epoch = sessionStore.getCredentials()?.epoch ?? -1;
  const routes = useQuery(routesQuery);
  const op = useStaffOperation('paper', epoch, emptyPaper, (values, ticket, signal) => createPaper(paperBody(values), ticket, signal), fieldNames);
  const { state } = op;
  const id = useId();
  const review = useRef<HTMLDivElement>(null), resultHeading = useRef<HTMLHeadingElement>(null);
  const previousPhase = useRef(state.phase);
  useEffect(() => {
    const before = previousPhase.current; previousPhase.current = state.phase;
    if (state.phase === 'review') review.current?.focus();
    else if (state.phase === 'confirmed') resultHeading.current?.focus();
    else if (state.phase === 'edit' && before !== 'edit') document.getElementById(`${id}-${fieldNames.find(name => state.errors[name]) ?? fieldNames[0]}`)?.focus();
  }, [state.phase, state.errors, id]);
  const active = routes.data?.filter(route => route.is_active === true) ?? [];
  const available = routes.isSuccess && !routes.isFetching && active.length > 0;
  const selected = active.find(route => route.id === Number(state.values.route_id));
  const validate = () => validatePaper(state.values, available ? routes.data! : []);
  function checkPaper() {
    const errors = validate(); op.review(errors);
    const first = fieldNames.find(name => errors[name]);
    if (first) requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
  }
  if (state.phase === 'confirmed' && state.result) return <><h1 ref={resultHeading} tabIndex={-1}>Ответ по бумажной анкете получен</h1><div className={styles.panel}>
    <dl className={styles.facts}><div><dt>Назначенный номер анкеты</dt><dd>{state.result.form_id}</dd></div><div><dt>Номер участника</dt><dd>{state.result.participant_id}</dd></div><div><dt>Отметка оплаты в системе</dt><dd>{state.result.payment_status}</dd></div></dl>
    <p>Отметка оплаты в системе не подтверждает получение денег.</p><p>Запишите номер анкеты. На экране сопоставления введите его вручную вместе со штрихкодом карты.</p>
    {state.duplicateRisk && <p className={common.alert}>Ранее была отправка без подтверждения. Проверьте возможные дубли с ответственным.</p>}
    <div className={common.actions}><Link className="primaryButton" to="/staff/typist/match">Перейти к сопоставлению</Link><button className={common.secondary} type="button" onClick={op.clear}>Следующая бумажная анкета</button></div>
  </div></>;
  return <><h1>Бумажная анкета</h1><p className={styles.intro}>Введите одну ещё не зарегистрированную бумажную анкету. Для онлайн-анкеты используйте сопоставление без создания новой записи.</p>
    <p className={styles.hint}>Номер анкеты назначается после сохранения. Заранее напечатанный номер здесь сохранить нельзя — сверьтесь с ответственным.</p>
    <OperationNotice message={state.message} uncertain={state.uncertain} acknowledged={op.acknowledged} acknowledge={op.setAcknowledged} disabled={state.phase === 'pending'} />
    {routes.isPending && <p role="status" className={styles.intro}>Загружаем маршруты…</p>}
    {routes.isError && <p role="alert" className={common.alert}>Не удалось загрузить маршруты. Введённые данные сохранены.</p>}
    {routes.isSuccess && !active.length && <p role="status" className={common.alert}>Доступных маршрутов пока нет.</p>}
    <div className={common.actions}><button className={common.secondary} type="button" disabled={routes.isFetching || state.phase === 'pending'} onClick={() => void routes.refetch()}>Обновить маршруты</button></div>
    {state.phase === 'review' ? <div ref={review} tabIndex={-1} className={styles.panel} role="region" aria-label="Проверка бумажной анкеты"><h2>Проверьте анкету перед созданием</h2>
      <dl className={styles.facts}>{fieldNames.map(name => <div key={name}><dt>{labels[name]}</dt><dd>{name === 'route_id' ? selected ? `${selected.name} · ${selected.year} · ${selected.distance} км` : 'Маршрут недоступен' : state.values[name] || 'Не указано'}</dd></div>)}</dl>
      <div className={common.actions}><button className={common.submit} type="button" disabled={!available || (state.uncertain && !op.acknowledged)} onClick={() => void op.confirm(validate)}>Подтвердить создание анкеты</button><button className={common.secondary} type="button" onClick={op.edit}>Вернуться к вводу</button></div>
    </div> : <form className={`${styles.form} ${styles.panel}`} noValidate aria-busy={state.phase === 'pending'} onSubmit={event => { event.preventDefault(); if (available) checkPaper(); }}>
      <fieldset disabled={state.phase === 'pending'} style={{ border: 0, padding: 0, margin: 0 }}><legend className={styles.hint}>Данные одной бумажной анкеты</legend><div className={styles.fields}>{fieldNames.map(name => {
        const fieldId = `${id}-${name}`, issue = state.errors[name];
        const commonInput = { id: fieldId, value: state.values[name], required: name !== 'middle_name', 'aria-invalid': Boolean(issue), 'aria-describedby': issue ? `${fieldId}-error` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => op.change(name, event.target.value) };
        return <div className={styles.field} key={name}><label htmlFor={fieldId}>{labels[name]}</label>
          {name === 'route_id' ? <select {...commonInput} disabled={!active.length || routes.isError || state.phase === 'pending'}><option value="">Выберите маршрут</option>{state.values.route_id && !selected && <option value={state.values.route_id} disabled>Выбранный маршрут недоступен</option>}{active.map(route => <option key={route.id} value={route.id}>{route.name} · {route.year} · {route.distance} км</option>)}</select>
            : name === 'gender' ? <select {...commonInput}><option value="">Выберите пол</option><option value="male">Мужской</option><option value="female">Женский</option></select>
              : <input {...commonInput} type={name === 'date_of_birth' ? 'date' : name === 'email' ? 'email' : name === 'phone_number' ? 'tel' : 'text'} />}
          {issue && <p id={`${fieldId}-error`} className={styles.error}>{issue}</p>}
        </div>;
      })}</div></fieldset>
      <p className={styles.hint}>{selected && <>{selected.name} · {selected.year} год · {selected.distance} км. </>}Год и активность маршрута не подтверждают открытие регистрации.</p>
      <div className={common.actions}><button className={common.submit} type="submit" disabled={state.phase === 'pending' || !available || (state.uncertain && !op.acknowledged)}>Проверить анкету</button></div>
      {state.phase === 'pending' && <p role="status" className={styles.intro}>Ждём подтверждение создания анкеты…</p>}
    </form>}
  </>;
}
