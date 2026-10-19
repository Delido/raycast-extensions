import { Action, ActionPanel, Keyboard, Color, Detail, Icon, List } from "@raycast/api";
import { useState } from "react";
import { buildQuery, formatDate, itemUrl, PullRequest } from "./api";
import { useOneDevQuery } from "./hooks";
import { absolutizeMarkdown } from "./search-issues";

const FILTERS: { title: string; value: string }[] = [
  { title: "Open", value: "open" },
  { title: "To Be Reviewed by Me", value: "to be reviewed by me" },
  { title: "Submitted by Me", value: "submitted by me" },
  { title: "Assigned to Me", value: "assigned to me" },
  { title: "Merged", value: "merged" },
  { title: "All", value: "" },
];

type PullRequestWithPath = PullRequest & { projectPath?: string };

const STATUS: Record<PullRequest["status"], { label: string; color: Color; icon: Icon }> = {
  OPEN: { label: "Open", color: Color.Green, icon: Icon.Shuffle },
  MERGED: { label: "Merged", color: Color.Purple, icon: Icon.CheckCircle },
  DISCARDED: { label: "Discarded", color: Color.Red, icon: Icon.XMarkCircle },
};

export function PullRequestList({ projectPath }: { projectPath?: string }) {
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState(FILTERS[0].value);

  const scope = projectPath ? `"Target Project" is "${projectPath}"` : "";
  const base = [scope, filter].filter(Boolean).join(" and ");
  const query = buildQuery(base, searchText, 'order by "Last Activity Date" desc');
  const { data, isLoading, pagination } = useOneDevQuery<PullRequest>("pulls", query, (p) => p.targetProjectId);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={projectPath ? `Search pull requests in ${projectPath}...` : "Search pull requests..."}
      pagination={pagination}
      throttle
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" storeValue onChange={setFilter}>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.title} title={f.title} value={f.value} />
          ))}
        </List.Dropdown>
      }
    >
      {data?.map((pr) => (
        <PullRequestItem key={pr.id} pr={pr} />
      ))}
      <List.EmptyView title="No pull requests found" icon={Icon.MagnifyingGlass} />
    </List>
  );
}

function PullRequestItem({ pr }: { pr: PullRequestWithPath }) {
  const url = itemUrl(pr.projectPath, "pulls", pr.number);
  const reference = `${pr.projectPath ?? ""}#${pr.number}`;
  const status = STATUS[pr.status] ?? STATUS.OPEN;
  return (
    <List.Item
      icon={{ source: status.icon, tintColor: status.color }}
      title={pr.title}
      subtitle={reference}
      keywords={[String(pr.number)]}
      accessories={[
        ...(pr.workInProgress ? [{ tag: { value: "WIP", color: Color.Yellow } }] : []),
        ...(pr.sourceBranch && pr.targetBranch ? [{ text: `${pr.sourceBranch} → ${pr.targetBranch}` }] : []),
        { tag: { value: status.label, color: status.color } },
        {
          date: new Date(pr.lastActivity?.date ?? pr.submitDate),
          tooltip: `Last activity ${formatDate(pr.lastActivity?.date ?? pr.submitDate)}`,
        },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={url} />
          <Action.Push title="Show Details" icon={Icon.Sidebar} target={<PullRequestDetail pr={pr} />} />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Reference"
              content={reference}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            {pr.sourceBranch && <Action.CopyToClipboard title="Copy Source Branch" content={pr.sourceBranch} />}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function PullRequestDetail({ pr }: { pr: PullRequestWithPath }) {
  const url = itemUrl(pr.projectPath, "pulls", pr.number);
  const status = STATUS[pr.status] ?? STATUS.OPEN;
  const markdown = `# ${pr.title}\n\n${absolutizeMarkdown(pr.description || "_No description_")}`;
  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${pr.projectPath ?? ""}#${pr.number}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Project" text={pr.projectPath ?? "-"} />
          <Detail.Metadata.Label title="Number" text={`#${pr.number}`} />
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={status.label} color={status.color} />
            {pr.workInProgress && <Detail.Metadata.TagList.Item text="WIP" color={Color.Yellow} />}
          </Detail.Metadata.TagList>
          {pr.sourceBranch && <Detail.Metadata.Label title="Source Branch" text={pr.sourceBranch} />}
          {pr.targetBranch && <Detail.Metadata.Label title="Target Branch" text={pr.targetBranch} />}
          <Detail.Metadata.Label title="Submitted" text={formatDate(pr.submitDate)} />
          {pr.lastActivity && (
            <Detail.Metadata.Label
              title="Last Activity"
              text={`${pr.lastActivity.description} · ${formatDate(pr.lastActivity.date)}`}
            />
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Link title="Open" target={url} text="Open in OneDev" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={url} />
          <Action.CopyToClipboard title="Copy URL" content={url} />
        </ActionPanel>
      }
    />
  );
}

export default function SearchPullRequests() {
  return <PullRequestList />;
}
