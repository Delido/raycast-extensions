import { usePromise } from "@raycast/utils";
import { apiUrl, authHeaders, parseResponse, resolveProjectPaths } from "./api";

const PAGE_SIZE = 50;

/**
 * Runs a paginated OneDev query against the given entity endpoint and resolves
 * project paths so that every item can link to its web page.
 */
export function useOneDevQuery<T>(endpoint: string, query: string, getProjectId: (item: T) => number) {
  return usePromise(
    (endpoint: string, query: string) =>
      async ({ page }: { page: number }) => {
        const items = (await parseResponse(
          await fetch(apiUrl(endpoint, { query, offset: String(page * PAGE_SIZE), count: String(PAGE_SIZE) }), {
            headers: authHeaders(),
          }),
        )) as T[];
        const paths = await resolveProjectPaths([...new Set(items.map(getProjectId))]);
        return {
          data: items.map((item) => ({ ...item, projectPath: paths[getProjectId(item)] as string | undefined })),
          hasMore: items.length === PAGE_SIZE,
        };
      },
    [endpoint, query],
  );
}
