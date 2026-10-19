import { Action, ActionPanel, Keyboard, Color, Detail, Icon, List } from "@raycast/api";
import { useState } from "react";
import { buildQuery, formatDate, getServerUrl, Issue, itemUrl } from "./api";
import { useOneDevQuery } from "./hooks";

const FILTERS: { title: string; value: string }[] = [
  { title: "Open", value: '"State" is "Open"' },
  { title: "Assigned to Me", value: '"Assignee" is me' },
  { title: "Submitted by Me", value: "submitted by me" },
  { title: "Watched by Me", value: "watched by me" },
  { title: "Mentioned Me", value: "mentioned me" },
  { title: "All", value: "" },
];

type IssueWithPath = Issue & { projectPath?: string };

function stateColor(state: string) {
  const s = state.toLowerCase();
  if (s === "open") return Color.Green;
  if (s === "closed" || s === "released") return Color.Purple;
  if (s.includes("progress")) return Color.Orange;
  return Color.Blue;
}

export function IssueList({ projectPath }: { projectPath?: string }) {
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState(FILTERS[0].value);

  const scope = projectPath ? `"Project" is "${projectPath}"` : "";
  const base = [scope, filter].filter(Boolean).join(" and ");
  const query = buildQuery(base, searchText, 'order by "Last Activity Date" desc');
  const { data, isLoading, pagination } = useOneDevQuery<Issue>("issues", query, (i) => i.projectId);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={projectPath ? `Search issues in ${projectPath}...` : "Search issues..."}
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
      {data?.map((issue) => (
        <IssueItem key={issue.id} issue={issue} />
      ))}
      <List.EmptyView title="No issues found" icon={Icon.MagnifyingGlass} />
    </List>
  );
}

function IssueItem({ issue }: { issue: IssueWithPath }) {
  const url = itemUrl(issue.projectPath, "issues", issue.number);
  const reference = `${issue.projectPath ?? ""}#${issue.number}`;
  return (
    <List.Item
      icon={{ source: Icon.Circle, tintColor: stateColor(issue.state) }}
      title={issue.title}
      subtitle={reference}
      keywords={[String(issue.number)]}
      accessories={[
        ...(issue.confidential ? [{ icon: Icon.Lock, tooltip: "Confidential" }] : []),
        ...(issue.commentCount ? [{ icon: Icon.SpeechBubble, text: String(issue.commentCount) }] : []),
        { tag: { value: issue.state, color: stateColor(issue.state) } },
        {
          date: new Date(issue.lastActivity?.date ?? issue.submitDate),
          tooltip: `Last activity ${formatDate(issue.lastActivity?.date ?? issue.submitDate)}`,
        },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={url} />
          <Action.Push title="Show Details" icon={Icon.Sidebar} target={<IssueDetail issue={issue} />} />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Reference"
              content={reference}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            <Action.CopyToClipboard title="Copy Title" content={issue.title} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/** Makes relative links (e.g. attachments) absolute so they render in Raycast. */
export function absolutizeMarkdown(markdown: string): string {
  return markdown.replace(/\]\((\/[^)]+)\)/g, (_, path) => `](${getServerUrl()}${path})`);
}

function IssueDetail({ issue }: { issue: IssueWithPath }) {
  const url = itemUrl(issue.projectPath, "issues", issue.number);
  const markdown = `# ${issue.title}\n\n${absolutizeMarkdown(issue.description || "_No description_")}`;
  return (
    <Detail
      markdown={markdown}
      navigationTitle={`${issue.projectPath ?? ""}#${issue.number}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Project" text={issue.projectPath ?? "-"} />
          <Detail.Metadata.Label title="Number" text={`#${issue.number}`} />
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item text={issue.state} color={stateColor(issue.state)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Submitted" text={formatDate(issue.submitDate)} />
          {issue.lastActivity && (
            <Detail.Metadata.Label
              title="Last Activity"
              text={`${issue.lastActivity.description} · ${formatDate(issue.lastActivity.date)}`}
            />
          )}
          <Detail.Metadata.Label title="Comments" text={String(issue.commentCount)} />
          <Detail.Metadata.Label title="Votes" text={String(issue.voteCount)} />
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

export default function SearchIssues() {
  return <IssueList />;
}
