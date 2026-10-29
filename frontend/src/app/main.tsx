import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/roboto/cyrillic-400.css';
import '@fontsource/roboto/cyrillic-700.css';
import '@fontsource/roboto/cyrillic-900.css';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-900.css';
import '../shared/styles/global.css';
import { appRoutes } from './router';

const router = createBrowserRouter(appRoutes);
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>,
);
