import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { EmptyState } from './components/EmptyState';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { ChatsPage } from './features/chats/ChatsPage';
import { ProfilePage } from './features/settings/ProfilePage';
import { SettingsLayout } from './features/settings/SettingsLayout';
import { UsersPage } from './features/settings/UsersPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/chats" replace /> },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'chats/:conversationId', element: <ChatsPage /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/profile" replace /> },
          { path: 'profile', element: <ProfilePage /> },
          {
            path: 'users',
            element: (
              <RequireAuth admin>
                <UsersPage />
              </RequireAuth>
            ),
          },
          {
            path: 'whatsapp',
            element: (
              <RequireAuth admin>
                <EmptyState title="Koneksi WhatsApp">Segera hadir.</EmptyState>
              </RequireAuth>
            ),
          },
          {
            path: 'api',
            element: (
              <RequireAuth admin>
                <EmptyState title="API & Webhook">Segera hadir.</EmptyState>
              </RequireAuth>
            ),
          },
        ],
      },
      { path: '*', element: <EmptyState title="Halaman tidak ditemukan" /> },
    ],
  },
]);
