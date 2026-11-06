import { useCachedPromise, usePromise } from "@raycast/utils";
import { Config, loadConfig } from "./config";
import { getAssignedProjects } from "./moco";

export function useConfig() {
  return usePromise(loadConfig);
}

/** Assigned MOCO projects, cached across commands (plain arrays survive the JSON cache). */
export function useProjects(config: Config | undefined) {
  return useCachedPromise(
    async (domain: string | undefined) => {
      if (!domain || !config?.moco) return [];
      return getAssignedProjects(config.moco);
    },
    [config?.moco?.domain],
    { keepPreviousData: true, execute: !!config?.moco },
  );
}
