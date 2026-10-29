import type { RouteObject } from 'react-router';
import { PublicLayout } from '../layouts/PublicLayout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const appRoutes: RouteObject[] = [{
  Component: PublicLayout,
  hydrateFallbackElement: <div className="contentPage container" role="status">Загружаем страницу…</div>,
  children: [
    { index: true, Component: HomePage },
    { path: 'routes', lazy: async () => ({ Component: (await import('../pages/RoutesPage')).RoutesPage }) },
    { path: '*', Component: NotFoundPage },
  ],
}];
