import { Action, ActionPanel, Keyboard, Color, Icon, List } from "@raycast/api";
import { useState } from "react";
import { Build, BuildStatus, buildQuery, formatDate, itemUrl } from "./api";
import { useOneDevQuery } from "./hooks";

const FILTERS: { title: string; value: string }[] = [
  { title: "All", value: "" },
  { title: "Running", value: "running" },
  { title: "Failed", value: "failed" },
  { title: "Successful", value: "successful" },
  { title: "Submitted by Me", value: "submitted by me" },
];

const STATUS: Record<BuildStatus, { label: string; color: Color; icon: Icon }> = {
  WAITING: { label: "Waiting", color: Color.SecondaryText, icon: Icon.Clock },
  PENDING: { label: "Pending", color: Color.Yellow, icon: Icon.Clock },
  RUNNING: { label: "Running", color: Color.Blue, icon: Icon.CircleProgress50 },
  SUCCESSFUL: { label: "Successful", color: Color.Green, icon: Icon.CheckCircle },
  FAILED: { label: "Failed", color: Color.Red, icon: Icon.XMarkCircle },
  CANCELLED: { label: "Cancelled", color: Color.SecondaryText, icon: Icon.MinusCircle },
  TIMED_OUT: { label: "Timed Out", color: Color.Orange, icon: Icon.Hourglass },
};

function shortRef(ref: string | null) {
  if (!ref) return undefined;
  return ref.replace(/^refs\/(heads|tags)\//, "").replace(/^refs\/pull\/(\d+)\/.*/, "PR #$1");
}

export function BuildList({ projectPath }: { projectPath?: string }) {
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState(FILTERS[0].value);

  const scope = projectPath ? `"Project" is "${projectPath}"` : "";
  const base = [scope, filter].filter(Boolean).join(" and ");
  const query = buildQuery(base, searchText, 'order by "Submit Date" desc');
  const { data, isLoading, pagination } = useOneDevQuery<Build>("builds", query, (b) => b.projectId);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={projectPath ? `Search builds in ${projectPath}...` : "Search builds..."}
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
      {data?.map((build) => {
        const status = STATUS[build.status] ?? STATUS.WAITING;
        const url = itemUrl(build.projectPath, "builds", build.number);
        const ref = shortRef(build.refName);
        return (
          <List.Item
            key={build.id}
            icon={{ source: status.icon, tintColor: status.color }}
            title={`${build.jobName}${build.version ? ` (${build.version})` : ""}`}
            subtitle={`${build.projectPath ?? ""}#${build.number}`}
            keywords={[String(build.number), build.commitHash.slice(0, 8)]}
            accessories={[
              ...(ref ? [{ icon: Icon.Code, text: ref }] : []),
              { tag: { value: status.label, color: status.color } },
              {
                date: new Date(build.finishDate ?? build.submitDate),
                tooltip: build.finishDate
                  ? `Finished ${formatDate(build.finishDate)}`
                  : `Submitted ${formatDate(build.submitDate)}`,
              },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser url={url} />
                <Action.OpenInBrowser title="Open Log" url={`${url}/log`} icon={Icon.Terminal} />
                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy URL" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
                  <Action.CopyToClipboard
                    title="Copy Commit Hash"
                    content={build.commitHash}
                    shortcut={Keyboard.Shortcut.Common.CopyName}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
      <List.EmptyView title="No builds found" icon={Icon.MagnifyingGlass} />
    </List>
  );
}

export default function SearchBuilds() {
  return <BuildList />;
}
