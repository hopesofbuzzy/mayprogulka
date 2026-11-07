import type { ReactNode } from 'react';
import common from '../participants/Participants.module.css';

export function OperationNotice({ message, uncertain, acknowledged, acknowledge, disabled = false, children }: { message: string; uncertain: boolean; acknowledged: boolean; acknowledge: (value: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  if (!message && !uncertain) return null;
  return <div className={common.alert} role="alert">
    {message && <strong>{message}</strong>}
    {uncertain && <><p>Не отправляйте данные повторно без проверки с ответственным: запись или связь могла сохраниться. Отсутствие карты в этом списке не подтверждает нужную пару; проверить её по номеру здесь нельзя.</p>
      <label className={common.acknowledgement}><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => acknowledge(event.target.checked)} /><span>Я проверил ситуацию с ответственным и понимаю, что повтор может создать дубль записи или привязки.</span></label></>}
    {children}
  </div>;
}
