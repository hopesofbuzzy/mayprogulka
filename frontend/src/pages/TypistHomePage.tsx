import { Link } from 'react-router';
import styles from '../features/typist/Typist.module.css';
import common from '../features/participants/Participants.module.css';

export function TypistHomePage() {
  return <><h1>Рабочее место наборщика</h1><p className={styles.intro}>Выберите сценарий по исходной анкете. Физическую карту выдают на старте, а её номер сопоставляют с анкетой позднее — участнику не нужно ждать записи в базе.</p>
    <div className={styles.choices}>
      <article className={styles.panel}><h2>Онлайн-анкета уже зарегистрирована</h2><p>Используйте существующий номер анкеты и штрихкод стикера физической карты. Повторно создавать участника не нужно.</p><div className={common.actions}><Link className="primaryButton" to="/staff/typist/match">Сопоставить с картой</Link></div></article>
      <article className={styles.panel}><h2>Анкета заполнена на бумаге</h2><p>Сначала введите одну анкету. Сервер назначит её номер. Затем вручную используйте полученный номер для сопоставления.</p><div className={common.actions}><Link className="primaryButton" to="/staff/typist/new">Создать бумажную запись</Link></div></article>
    </div><p className={styles.intro}>Одинаковые стикеры на карте и анкете обозначают номер физической карты. Номер анкеты, ID участника и штрихкод карты — разные идентификаторы.</p><Link className={common.textLink} to="/staff/typist/unlinked">Открыть выборку непривязанных карт</Link>
  </>;
}
