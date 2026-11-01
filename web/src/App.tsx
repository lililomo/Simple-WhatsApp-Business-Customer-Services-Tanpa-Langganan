import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { queryClient } from './lib/query';
import { useTheme } from './lib/theme';
import { router } from './routes';

export function App() {
  const { theme } = useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme={theme} position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
