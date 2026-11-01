import { queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { sessionStore } from '../../shared/session/store';
import { myParticipantsOptions } from '../participants/api';
import type { Participant } from '../participants/model';
import type { Payment } from './api';

export type PaymentRecord = {
  phase: 'idle' | 'pending' | 'accepted' | 'uncertain' | 'rejected';
  verification: 'none' | 'checking' | 'paid' | 'pending' | 'unknown' | 'missing' | 'error';
  subject?: Pick<Participant, 'id' | 'surname' | 'name' | 'route_name' | 'form_id'>;
  result?: Payment;
  message?: string;
};
const initial: PaymentRecord = { phase: 'idle', verification: 'none' };
export function paymentRecordOptions(epoch: number, id: number) {
  return queryOptions({
    queryKey: ['private', 'payment', epoch, id] as const, meta: { private: true },
    initialData: initial, enabled: false, retry: false, gcTime: Infinity, staleTime: Infinity,
    queryFn: async (): Promise<PaymentRecord> => initial,
  });
}
export function updatePaymentRecord(client: QueryClient, epoch: number, id: number, change: (record: PaymentRecord) => PaymentRecord) {
  if (sessionStore.isCurrentSession(epoch)) client.setQueryData<PaymentRecord>(paymentRecordOptions(epoch, id).queryKey, current => change(current ?? initial));
}
export async function verifyPayment(client: QueryClient, epoch: number, id: number) {
  if (!sessionStore.isCurrentSession(epoch)) return;
  updatePaymentRecord(client, epoch, id, record => ({ ...record, verification: 'checking' }));
  const options = myParticipantsOptions(epoch);
  await client.cancelQueries({ queryKey: options.queryKey, exact: true });
  if (!sessionStore.isCurrentSession(epoch)) return;
  await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: 'none' });
  if (!sessionStore.isCurrentSession(epoch)) return;
  try {
    const participants = await client.fetchQuery({ ...options, staleTime: 0 });
    const participant = participants.find(item => item.id === id);
    const verification = !participant ? 'missing' : participant.payment_status === 'paid' ? 'paid' : participant.payment_status === 'pending' ? 'pending' : 'unknown';
    updatePaymentRecord(client, epoch, id, record => ({ ...record, verification }));
  } catch {
    updatePaymentRecord(client, epoch, id, record => ({ ...record, verification: 'error' }));
  }
}
