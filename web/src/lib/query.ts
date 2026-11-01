import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      // Sesi habis di tengah jalan: kosongkan data pengguna agar route guard mengarahkan ke login.
      if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(['me'], null);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});
