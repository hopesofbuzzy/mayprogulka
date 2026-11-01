import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/AuthProvider';
import { useMyParticipants } from '../features/participants/api';
import { paymentLabel, validParticipantId } from '../features/participants/model';
import { ParticipantsFailure } from '../features/participants/ParticipantsView';
import { payParticipant, PaymentFailure } from '../features/payments/api';
import type { PaymentMethod } from '../features/payments/api';
import { paymentRecordOptions, updatePaymentRecord, verifyPayment } from '../features/payments/state';
import { safeFormPdfUrl } from '../features/payments/safeFormPdfUrl';
import { sessionStore } from '../shared/session/store';
import { StaleSessionError } from '../shared/api/errors';
import common from '../features/participants/Participants.module.css';
import styles from '../features/payments/Payment.module.css';

function PaymentPage({ epoch, id }: { epoch: number; id: number | null }) {
  const client = useQueryClient();
  const mine = useMyParticipants(id !== null);
  const record = useQuery(paymentRecordOptions(epoch, id ?? -1)).data;
  const [method, setMethod] = useState<PaymentMethod>('card');
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const participant = mine.data?.find(item => item.id === id);
  const subject = participant ?? record.subject;
  const attempted = record.phase !== 'idle';
  const pending = record.phase === 'pending';
  const checking = record.verification === 'checking' || mine.isFetching;
  const confirmedPaid = mine.isSuccess && !mine.isFetching && participant?.payment_status === 'paid';
  const safePdf = safeFormPdfUrl(record.result?.form_pdf_url);
  useEffect(() => () => {
    if (controller.current && !controller.current.signal.aborted) {
      controller.current.abort();
      if (id !== null) updatePaymentRecord(client, epoch, id, current => current.phase === 'pending'
        ? { ...current, phase: 'uncertain', message: 'Запрос прерван на устройстве. Это не отменяет операцию на сервере. Сначала проверьте статус.' } : current);
    }
  }, [client, epoch, id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (id === null || busy.current || attempted || !mine.isSuccess || mine.isFetching || participant?.payment_status !== 'pending') return;
    // Also inspect the shared marker: navigation/remount must not bypass a POST in flight.
    const current = client.getQueryData(paymentRecordOptions(epoch, id).queryKey);
    if (current && current.phase !== 'idle') return;
    busy.current = true;
    const request = new AbortController();
    controller.current = request;
    updatePaymentRecord(client, epoch, id, () => ({ phase: 'pending', verification: 'none', subject: {
      id: participant.id, surname: participant.surname, name: participant.name, route_name: participant.route_name, form_id: participant.form_id,
    } }));
    try {
      const result = await payParticipant(id, method, epoch, request.signal);
      if (request.signal.aborted || !sessionStore.isCurrentSession(epoch)) return;
      updatePaymentRecord(client, epoch, id, state => ({ ...state, phase: 'accepted', result }));
      await verifyPayment(client, epoch, id);
    } catch (error) {
      if (error instanceof StaleSessionError || !sessionStore.isCurrentSession(epoch)) return;
      const failure = error instanceof PaymentFailure ? error : new PaymentFailure('Результат тестовой операции неизвестен. Сначала проверьте статус.', true);
      updatePaymentRecord(client, epoch, id, state => ({ ...state, phase: failure.uncertain ? 'uncertain' : 'rejected', message: failure.message }));
    } finally { busy.current = false; }
  }

  return <section className="container contentPage">
    <Link className={common.back} to={id !== null ? `/account/participants/${id}` : '/account'}>← {id !== null ? 'К карточке участника' : 'В личный кабинет'}</Link>
    <h1>Тестовая оплата</h1>
    <div className={styles.panel}>
      <p className={styles.banner}>Тестовая оплата — без списания денег</p>
      {id === null ? <div className={common.state}><h2>Некорректный номер участника</h2><p>Выберите участника из своего списка в кабинете.</p></div>
        : !subject && (mine.isPending || mine.isFetching) ? <p role="status" className={common.state}>Загружаем участника…</p>
          : !subject && mine.isError ? <ParticipantsFailure error={mine.error} pending={mine.isFetching} retry={() => void mine.refetch()} />
            : !subject ? <div className={common.state}><h2>Участник не найден среди ваших записей</h2><Link className={common.textLink} to="/account">В личный кабинет</Link></div>
              : <div className={common.detail}>
                <div className={styles.identity}><h2>{subject.surname} {subject.name}</h2><p>{subject.route_name}</p><p>Номер анкеты: {subject.form_id}</p><p>ID участника: {subject.id}</p></div>
                <p>Текущий статус участника: <strong>{mine.isSuccess && participant ? paymentLabel(participant.payment_status) : 'Сейчас не подтверждён'}</strong></p>
                {mine.isError && <ParticipantsFailure error={mine.error} pending={mine.isFetching} retry={() => { if (attempted) void verifyPayment(client, epoch, subject.id); else void mine.refetch(); }} />}
                {mine.isFetching && <p role="status" className={common.progress}>Обновляем статус участника…</p>}
                {!attempted && participant?.payment_status === 'pending' && <form onSubmit={event => void submit(event)} aria-busy={pending}>
                  <fieldset className={styles.methods} disabled={checking || !mine.isSuccess}>
                    <legend>Способ тестовой оплаты</legend>
                    <label><input type="radio" name="payment_method" value="card" checked={method === 'card'} onChange={() => setMethod('card')} />Карта (тест)</label>
                    <label><input type="radio" name="payment_method" value="sbp" checked={method === 'sbp'} onChange={() => setMethod('sbp')} />СБП (тест)</label>
                  </fieldset>
                  <div className={styles.explanation}><h3>Что будет дальше</h3><p>Тестовая операция изменит статус этого участника без перевода денег. После неё мы проверим актуальный статус. Анкета для печати может не появиться.</p><p>Если сервер предоставит разрешённую ссылку, она останется доступна только в текущей сессии. После обновления страницы или повторного входа восстановить её здесь нельзя.</p></div>
                  <div className={common.actions}><button className={common.submit} type="submit" disabled={checking || !mine.isSuccess}>Выполнить тестовую оплату</button></div>
                </form>}
                {pending && <div role="status" className={styles.result}><p>Ждём ответ тестовой операции…</p><fieldset className={styles.methods} disabled><legend>Способ тестовой оплаты</legend><label><input type="radio" checked readOnly />{method === 'card' ? 'Карта (тест)' : 'СБП (тест)'}</label></fieldset><button className={common.submit} disabled>Выполняем…</button></div>}
                {record.phase === 'accepted' && <div className={styles.result}>
                  <p>Операция принята сервером. Это тестовый ответ, без перевода денег.</p>
                  <p>Статус тестовой операции: <strong>{record.result?.status}</strong></p>
                  <p>Технический номер операции: {record.result?.payment_id}</p>
                  {!confirmedPaid && <p role="alert" className={common.alert}>Операция принята сервером, но актуальный статус ещё не подтверждён. Обновите статус; не отправляйте операцию повторно.</p>}
                </div>}
                {(record.phase === 'uncertain' || record.phase === 'rejected') && <div className={common.alert} role="alert"><strong>{record.message}</strong>{record.phase === 'uncertain' && <p>Возможно, тестовая операция уже прошла; повтор может создать дубль. Повторная отправка на этой странице недоступна. Даже статус «Ожидает оплаты» не доказывает, что операция не дошла.</p>}</div>}
                {record.verification === 'missing' && <p role="alert" className={common.alert}>В обновлённом списке участник не найден. Результат операции по статусу не подтверждён.</p>}
                {!pending && <div className={common.actions}><button type="button" className={common.secondary} disabled={checking} onClick={() => { if (attempted) void verifyPayment(client, epoch, subject.id); else void mine.refetch(); }}>Обновить статус</button><Link className={common.textLink} to="/account">В личный кабинет</Link></div>}
                {!attempted && participant?.payment_status === 'paid' && <p className={common.note}>Повторная тестовая оплата недоступна. Ссылка на анкету могла выдаваться только после операции и здесь не восстанавливается.</p>}
                {!attempted && participant && !['pending', 'paid'].includes(participant.payment_status) && <p className={common.note}>Этот статус не разрешает тестовую оплату. Обновите данные; допустимые статусы требуют уточнения.</p>}
                {record.phase === 'accepted' && <div className={styles.pdf}>
                  {safePdf ? <><a className={common.textLink} href={safePdf} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть анкету для печати</a><p className={common.note}>Распечатайте анкету и возьмите с собой на старт. После обновления страницы или повторного входа эта ссылка не восстанавливается.</p></>
                    : <p>{record.result?.form_pdf_url ? 'Адрес анкеты требует уточнения' : 'Анкета пока недоступна'}</p>}
                </div>}
              </div>}
    </div>
  </section>;
}

export function ParticipantPaymentPage() {
  const { isAuthenticated } = useAuth();
  const epoch = sessionStore.getCredentials()?.epoch;
  const id = validParticipantId(useParams().id);
  return isAuthenticated && epoch !== undefined ? <PaymentPage key={`${epoch}:${id}`} epoch={epoch} id={id} /> : null;
}
