import { useQuery } from '@tanstack/react-query';
import type { ConnectionDTO, ConnectionStatusDTO } from '@wa/shared';
import { api } from '@/lib/api';

export function useConnectionStatus() {
  return useQuery({
    queryKey: ['connection-status'],
    queryFn: () => api<ConnectionStatusDTO>('/api/connection/status'),
    refetchInterval: 60_000,
  });
}

export function useConnection() {
  return useQuery({
    queryKey: ['connection'],
    queryFn: async () => (await api<{ connection: ConnectionDTO | null }>('/api/connection')).connection,
  });
}
