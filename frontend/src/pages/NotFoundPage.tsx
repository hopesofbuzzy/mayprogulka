import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="contentPage container">
      <p className="intro">404 · Кажется, мы свернули с тропы</p>
      <h1 style={{ marginTop: 16 }}>Страница не найдена</h1>
      <p className="intro">Такой страницы нет. Вернитесь на главную и выберите свой путь.</p>
      <Link to="/" className="primaryButton" style={{ marginTop: 28 }}>На главную <span aria-hidden="true">↗</span></Link>
    </section>
  );
}
