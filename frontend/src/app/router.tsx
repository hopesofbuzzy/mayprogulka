import type { RouteObject } from 'react-router';
import { AppLayout } from './AppLayout';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequireTypist } from '../features/typist/RequireTypist';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const appRoutes: RouteObject[] = [{
  Component: AppLayout,
  hydrateFallbackElement: <div className="contentPage container" role="status">Загружаем страницу…</div>,
  children: [
    { index: true, Component: HomePage },
    { path: 'routes', lazy: async () => ({ Component: (await import('../pages/RoutesPage')).RoutesPage }) },
    { path: 'routes/:routeId', lazy: async () => ({ Component: (await import('../pages/RouteDetailPage')).RouteDetailPage }) },
    { path: 'how-to', lazy: async () => ({ Component: (await import('../pages/HowToPage')).HowToPage }) },
    { path: 'faq', lazy: async () => ({ Component: (await import('../pages/FaqPage')).FaqPage }) },
    { path: 'login', lazy: async () => ({ Component: (await import('../pages/AuthPage')).LoginPage }) },
    { path: 'signup', lazy: async () => ({ Component: (await import('../pages/AuthPage')).SignupPage }) },
    { Component: RequireAuth, children: [
      { path: 'account', lazy: async () => ({ Component: (await import('../pages/AccountPage')).AccountPage }) },
      { path: 'account/participants/new', lazy: async () => ({ Component: (await import('../pages/ParticipantRegistrationPage')).ParticipantRegistrationPage }) },
      { path: 'account/participants/:id', lazy: async () => ({ Component: (await import('../pages/ParticipantDetailPage')).ParticipantDetailPage }) },
      { path: 'account/participants/:id/pay', lazy: async () => ({ Component: (await import('../pages/ParticipantPaymentPage')).ParticipantPaymentPage }) },
      { Component: RequireTypist, children: [
        { path: 'staff/typist', lazy: async () => ({ Component: (await import('../pages/TypistHomePage')).TypistHomePage }) },
        { path: 'staff/typist/new', lazy: async () => ({ Component: (await import('../pages/TypistPaperPage')).TypistPaperPage }) },
        { path: 'staff/typist/match', lazy: async () => ({ Component: (await import('../pages/TypistMatchPage')).TypistMatchPage }) },
        { path: 'staff/typist/unlinked', lazy: async () => ({ Component: (await import('../pages/TypistUnlinkedPage')).TypistUnlinkedPage }) },
      ] },
    ] },
    { path: '*', Component: NotFoundPage },
  ],
}];
