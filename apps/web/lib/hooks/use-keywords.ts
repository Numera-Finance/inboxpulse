import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getKeywordClient } from '@/lib/api/clients';
import type { KeywordCategory } from '@crm/clients';

export const keywordKeys = {
  all: ['keywords'] as const,
};

export function useKeywords() {
  return useQuery({
    queryKey: keywordKeys.all,
    queryFn: ({ signal }) => getKeywordClient().getAll(signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveKeywords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entries: Array<{ category: KeywordCategory; keywords: string }>) =>
      Promise.all(
        entries.map(({ category, keywords }) =>
          getKeywordClient().save(category, keywords)
        )
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keywordKeys.all });
    },
  });
}
