import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import type { CreateEpicInput } from '@/lib/api-client';

export function useEpicMutations(projectId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-board', projectId] });

  const createEpic = useMutation({
    mutationFn: (data: CreateEpicInput) => apiClient.createEpic(projectId, data),
    onSuccess: invalidate,
  });
  const updateEpic = useMutation({
    mutationFn: ({ epicId, data }: { epicId: string; data: Partial<CreateEpicInput> }) =>
      apiClient.updateEpic(projectId, epicId, data),
    onSuccess: invalidate,
  });
  const transitionEpic = useMutation({
    mutationFn: ({ epicId, toStatus }: { epicId: string; toStatus: string }) =>
      apiClient.transitionEpic(projectId, epicId, toStatus),
    onSuccess: invalidate,
  });
  const reorderEpics = useMutation({
    mutationFn: ({ epicIds, status }: { epicIds: string[]; status: string }) =>
      apiClient.reorderEpics(projectId, epicIds, status),
    onSuccess: invalidate,
  });
  const deleteEpic = useMutation({
    mutationFn: (epicId: string) => apiClient.deleteEpic(projectId, epicId),
    onSuccess: invalidate,
  });

  return { createEpic, updateEpic, transitionEpic, reorderEpics, deleteEpic };
}
