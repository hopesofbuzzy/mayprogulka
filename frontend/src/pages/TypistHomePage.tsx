import { Link } from 'react-router';
import styles from '../features/typist/Typist.module.css';
import common from '../features/participants/Participants.module.css';

export function TypistHomePage() {
  return <><h1>Рабочее место наборщика</h1><p className={styles.intro}>Выберите действие по анкете: сопоставьте уже зарегистрированную или внесите бумажную.</p>
    <div className={styles.choices}>
      <article className={styles.panel}><h2>Онлайн-анкета уже зарегистрирована</h2><p>Используйте существующий номер анкеты и штрихкод стикера физической карты. Повторно создавать участника не нужно.</p><div className={common.actions}><Link className="primaryButton" to="/staff/typist/match">Сопоставить с картой</Link></div></article>
      <article className={styles.panel}><h2>Анкета заполнена на бумаге</h2><p>Введите одну анкету. Система назначит её номер — запишите его и используйте при сопоставлении с картой.</p><div className={common.actions}><Link className="primaryButton" to="/staff/typist/new">Создать бумажную запись</Link></div></article>
    </div><p className={styles.intro}>Номер анкеты, номер участника и штрихкод карты — разные значения. Сверяйте пару по исходной анкете и стикеру карты.</p><Link className={common.textLink} to="/staff/typist/unlinked">Открыть выборку непривязанных карт</Link>
  </>;
}
