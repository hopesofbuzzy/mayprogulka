import { useEffect, useId, useRef } from 'react';
import { matchMap } from '../features/typist/api';
import { emptyMatch, validateMatch } from '../features/typist/model';
import { useStaffOperation } from '../features/typist/operation';
import { OperationNotice } from '../features/typist/OperationNotice';
import { sessionStore } from '../shared/session/store';
import styles from '../features/typist/Typist.module.css';
import common from '../features/participants/Participants.module.css';

const names = ['form_id', 'barcode'] as const;
const labels = { form_id: 'Номер анкеты', barcode: 'Штрихкод физической карты' };
export function TypistMatchPage() {
  const epoch = sessionStore.getCredentials()?.epoch ?? -1;
  const op = useStaffOperation('match', epoch, emptyMatch, matchMap, names);
  const { state } = op;
  const id = useId(), review = useRef<HTMLDivElement>(null), resultHeading = useRef<HTMLHeadingElement>(null);
  const previousPhase = useRef(state.phase);
  useEffect(() => {
    const before = previousPhase.current; previousPhase.current = state.phase;
    if (state.phase === 'review') review.current?.focus();
    else if (state.phase === 'confirmed') resultHeading.current?.focus();
    else if (state.phase === 'edit' && before !== 'edit') document.getElementById(`${id}-${names.find(name => state.errors[name]) ?? names[0]}`)?.focus();
  }, [state.phase, state.errors, id]);
  function checkPair() {
    const errors = validateMatch(state.values); op.review(errors);
    const first = names.find(name => errors[name]);
    if (first) requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
  }
  if (state.phase === 'confirmed' && state.result) return <><h1 ref={resultHeading} tabIndex={-1}>Ответ сопоставления получен</h1><div className={styles.panel}>
    <dl className={styles.facts}><div><dt>Полученный статус</dt><dd>{state.result.status}</dd></div><div><dt>Номер анкеты из отправленной пары</dt><dd>{state.values.form_id}</dd></div><div><dt>Штрихкод карты в ответе</dt><dd>{state.result.barcode}</dd></div><div><dt>Номер участника</dt><dd>{state.result.participant_id}</dd></div><div><dt>Участник</dt><dd>{state.result.participant_name}</dd></div><div><dt>Сообщение</dt><dd>{state.result.message}</dd></div></dl>
    <p>Исправить или отменить сохранённую связь здесь нельзя. При спорном результате обратитесь к ответственному.</p>
    {state.duplicateRisk && <p className={common.alert}>Ранее была отправка без подтверждения. Повтор мог создать дубль; требуется проверка ответственным.</p>}
    <div className={common.actions}><button className={common.secondary} type="button" onClick={op.clear}>Следующая пара</button></div>
  </div></>;
  return <><h1>Сопоставление с картой</h1><p className={styles.intro}>Для уже зарегистрированной онлайн-анкеты введите существующий номер. Бумажную анкету сначала создают отдельно. Здесь выполняется только первичное сопоставление.</p>
    <OperationNotice message={state.message} uncertain={state.uncertain} acknowledged={op.acknowledged} acknowledge={op.setAcknowledged} disabled={state.phase === 'pending'} />
    {state.phase === 'review' ? <div ref={review} tabIndex={-1} className={styles.panel} role="region" aria-label="Проверка пары"><h2>Проверьте пару перед отправкой</h2><dl className={styles.facts}>{names.map(name => <div key={name}><dt>{labels[name]}</dt><dd>{state.values[name]}</dd></div>)}</dl>
      <p>Проверьте оба номера: отменить сохранённую связь здесь нельзя.</p><div className={common.actions}><button className={common.submit} type="button" disabled={state.uncertain && !op.acknowledged} onClick={() => void op.confirm(validateMatch)}>Подтвердить сопоставление</button><button className={common.secondary} type="button" onClick={op.edit}>Вернуться к вводу</button></div>
    </div> : <form className={`${styles.form} ${styles.panel}`} noValidate onSubmit={event => event.preventDefault()} aria-busy={state.phase === 'pending'}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }} disabled={state.phase === 'pending'}><legend className={styles.hint}>Пара анкеты и физической карты</legend><div className={styles.fields}>{names.map((name, index) => <div className={styles.field} key={name}><label htmlFor={`${id}-${name}`}>{labels[name]}</label><input id={`${id}-${name}`} type="text" required value={state.values[name]} autoComplete="off" spellCheck={false} aria-invalid={Boolean(state.errors[name])} aria-describedby={state.errors[name] ? `${id}-${name}-error` : undefined} onChange={event => op.change(name, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); document.getElementById(index === 0 ? `${id}-barcode` : `${id}-review`)?.focus(); } }} />{state.errors[name] && <p className={styles.error} id={`${id}-${name}-error`}>{state.errors[name]}</p>}</div>)}</div></fieldset>
      <p className={styles.hint}>Ввод сохраняется буквально, включая ведущие нули. Enter переводит фокус, но не отправляет пару.</p>
      <div className={common.actions}><button id={`${id}-review`} className={common.submit} type="button" disabled={state.phase === 'pending' || (state.uncertain && !op.acknowledged)} onClick={checkPair}>Проверить пару</button><button className={common.secondary} type="button" disabled={state.phase === 'pending' || state.uncertain} onClick={op.clear}>Очистить ввод</button></div>
      {state.phase === 'pending' && <p role="status" className={styles.intro}>Ждём ответ сопоставления…</p>}
    </form>}
  </>;
}
