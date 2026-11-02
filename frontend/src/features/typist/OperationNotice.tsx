import type { ReactNode } from 'react';
import common from '../participants/Participants.module.css';

export function OperationNotice({ message, uncertain, acknowledged, acknowledge, disabled = false, children }: { message: string; uncertain: boolean; acknowledged: boolean; acknowledge: (value: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  if (!message && !uncertain) return null;
  return <div className={common.alert} role="alert">
    {message && <strong>{message}</strong>}
    {uncertain && <><p>Исход предыдущей отправки неизвестен. Нет проверки анкеты или пары по номеру через текущий API. Отсутствие карты в ограниченной выборке не доказывает нужную связь.</p>
      <label className={common.acknowledgement}><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => acknowledge(event.target.checked)} /><span>Я проверил ситуацию с ответственным и понимаю, что повтор может создать дубль записи или привязки.</span></label></>}
    {children}
  </div>;
}
