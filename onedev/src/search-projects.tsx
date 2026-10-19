import { Action, ActionPanel, Keyboard, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  apiUrl,
  authHeaders,
  buildQuery,
  formatDate,
  parseResponse,
  primaryShortcut,
  Project,
  projectUrl,
} from "./api";
import { IssueList } from "./search-issues";
import { PullRequestList } from "./search-pull-requests";
import { BuildList } from "./search-builds";

const PAGE_SIZE = 50;

export default function SearchProjects() {
  const [searchText, setSearchText] = useState("");
  const query = buildQuery("", searchText, 'order by "Last Activity Date" desc');

  const { data, isLoading, pagination } = usePromise(
    (query: string) =>
      async ({ page }: { page: number }) => {
        const items = (await parseResponse(
          await fetch(apiUrl("projects", { query, offset: String(page * PAGE_SIZE), count: String(PAGE_SIZE) }), {
            headers: authHeaders(),
          }),
        )) as Project[];
        return { data: items, hasMore: items.length === PAGE_SIZE };
      },
    [query],
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search projects..."
      pagination={pagination}
      throttle
    >
      {data?.map((project) => {
        const url = projectUrl(project.path);
        return (
          <List.Item
            key={project.id}
            icon={project.codeManagement ? Icon.Code : Icon.Folder}
            title={project.path}
            subtitle={project.description ?? undefined}
            accessories={[
              ...(project.key ? [{ tag: project.key }] : []),
              { date: new Date(project.createDate), tooltip: `Created ${formatDate(project.createDate)}` },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={url} />
                <ActionPanel.Section>
                  <Action.Push
                    title="Show Issues"
                    icon={Icon.Bug}
                    shortcut={primaryShortcut("i")}
                    target={<IssueList projectPath={project.path} />}
                  />
                  <Action.Push
                    title="Show Pull Requests"
                    icon={Icon.Shuffle}
                    shortcut={primaryShortcut("r")}
                    target={<PullRequestList projectPath={project.path} />}
                  />
                  <Action.Push
                    title="Show Builds"
                    icon={Icon.Hammer}
                    shortcut={primaryShortcut("b")}
                    target={<BuildList projectPath={project.path} />}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
                  <Action.CopyToClipboard
                    title="Copy Clone URL"
                    content={url}
                    shortcut={Keyboard.Shortcut.Common.CopyName}
                  />
                  <Action.CopyToClipboard title="Copy Path" content={project.path} />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
      <List.EmptyView title="No projects found" icon={Icon.MagnifyingGlass} />
    </List>
  );
}
