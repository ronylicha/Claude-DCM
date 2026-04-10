import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

export function useProjectBoard(projectId: string) {
  return useQuery({
    queryKey: ['project-board', projectId],
    queryFn: () => apiClient.getProjectBoard(projectId),
    refetchInterval: 5000,
    enabled: !!projectId,
  });
}
