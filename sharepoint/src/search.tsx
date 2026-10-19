import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { ReactNode, useState } from "react";
import { getConfig, signOut } from "./auth";
import {
  desktopAppUrl,
  DriveItemResource,
  fileExtension,
  formatDate,
  formatSize,
  formatSummary,
  locationFromUrl,
  primaryShortcut,
  SearchHit,
  searchMany,
  SearchRequest,
  SiteResource,
} from "./graph";

const PAGE_SIZE = 25;

// Site pages are indexed as list items of the "Site Pages" library, documents as drive items.
const PAGES: SearchRequest = {
  entityType: "listItem",
  kql: "contentclass:STS_ListItem_WebPageLibrary",
  fields: ["title", "webUrl", "lastModifiedDateTime", "lastModifiedBy", "createdBy", "createdDateTime"],
  // The index also files page asset folders (SiteAssets/SitePages/<page>) under this class; real pages are .aspx.
  urlFilter: /\.aspx(\?|#|$)/i,
};

const FILTERS: { title: string; value: string; requests: SearchRequest[] }[] = [
  { title: "Pages", value: "pages", requests: [PAGES] },
  { title: "Documents & Pages", value: "all", requests: [{ entityType: "driveItem", kql: "" }, PAGES] },
  { title: "Documents", value: "documents", requests: [{ entityType: "driveItem", kql: "-filetype:aspx" }] },
  { title: "Word", value: "word", requests: [{ entityType: "driveItem", kql: "(filetype:docx OR filetype:doc)" }] },
  { title: "PDF", value: "pdf", requests: [{ entityType: "driveItem", kql: "filetype:pdf" }] },
  { title: "Excel", value: "excel", requests: [{ entityType: "driveItem", kql: "(filetype:xlsx OR filetype:xls)" }] },
  {
    title: "PowerPoint",
    value: "powerpoint",
    requests: [{ entityType: "driveItem", kql: "(filetype:pptx OR filetype:ppt)" }],
  },
  { title: "Sites", value: "sites", requests: [{ entityType: "site", kql: "" }] },
];

const FILE_ICONS: Record<string, { source: Icon; tintColor: Color }> = {
  docx: { source: Icon.Document, tintColor: Color.Blue },
  doc: { source: Icon.Document, tintColor: Color.Blue },
  xlsx: { source: Icon.BarChart, tintColor: Color.Green },
  xls: { source: Icon.BarChart, tintColor: Color.Green },
  pptx: { source: Icon.Image, tintColor: Color.Orange },
  ppt: { source: Icon.Image, tintColor: Color.Orange },
  pdf: { source: Icon.Document, tintColor: Color.Red },
  aspx: { source: Icon.Globe, tintColor: Color.Purple },
};

function isSite(hit: SearchHit): hit is SearchHit & { resource: SiteResource } {
  return hit.resource["@odata.type"] === "#microsoft.graph.site";
}

export default function SearchSharePoint() {
  const { clientId } = getConfig();
  const [searchText, setSearchText] = useState("");
  const [filterValue, setFilterValue] = useState(FILTERS[0].value);
  const [showDetail, setShowDetail] = useState(false);

  const filter = FILTERS.find((f) => f.value === filterValue) ?? FILTERS[0];
  const text = searchText.trim();
  const { data, isLoading, pagination, revalidate, error } = usePromise(
    (text: string, filterValue: string, enabled: boolean) =>
      async ({ page }: { page: number }) => {
        if (!enabled) return { data: [] as SearchHit[], hasMore: false };
        const requests = (FILTERS.find((f) => f.value === filterValue) ?? FILTERS[0]).requests;
        const result = await searchMany(requests, text, page * PAGE_SIZE, PAGE_SIZE);
        return { data: result.hits, hasMore: result.hasMore };
      },
    [text, filter.value, !!text && !!clientId],
    {
      onError: (error) => {
        showToast({ style: Toast.Style.Failure, title: "SharePoint search failed", message: error.message });
      },
    },
  );

  if (!clientId) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Gear}
          title="SharePoint is not configured yet"
          description="Enter the Client ID of the Entra ID app registration in the extension preferences."
          actions={
            <ActionPanel>
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const toggleDetail = () => setShowDetail((v) => !v);
  const signOutAction = <SignOutAction onSignedOut={revalidate} />;

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search SharePoint..."
      pagination={pagination}
      isShowingDetail={showDetail && !!data?.length}
      throttle
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" defaultValue="pages" onChange={setFilterValue}>
          {FILTERS.map((f) => (
            <List.Dropdown.Item key={f.value} title={f.title} value={f.value} />
          ))}
        </List.Dropdown>
      }
    >
      {data?.map((hit) =>
        isSite(hit) ? (
          <SiteItem key={hit.hitId} hit={hit} signOutAction={signOutAction} />
        ) : (
          <DocumentItem
            key={hit.hitId}
            hit={hit as SearchHit & { resource: DriveItemResource }}
            showDetail={showDetail}
            toggleDetail={toggleDetail}
            signOutAction={signOutAction}
          />
        ),
      )}
      {error && !isLoading ? (
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title="Search failed"
          description={error.message}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Error" content={error.message} />
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
              {signOutAction}
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={text ? "No results" : "Type to search SharePoint"}
          description={text ? undefined : 'Supports KQL, e.g. author:"Jane Doe" or "exact phrase"'}
          actions={<ActionPanel>{signOutAction}</ActionPanel>}
        />
      )}
    </List>
  );
}

function DocumentItem({
  hit,
  showDetail,
  toggleDetail,
  signOutAction,
}: {
  hit: SearchHit & { resource: DriveItemResource };
  showDetail: boolean;
  toggleDetail: () => void;
  signOutAction: ReactNode;
}) {
  const item = hit.resource;
  const ext = fileExtension(item.name);
  const location = locationFromUrl(item.webUrl);
  const appUrl = desktopAppUrl(item.name, item.webUrl);
  const modifiedBy = item.lastModifiedBy?.user?.displayName;
  const title = ext === "aspx" ? item.name.replace(/\.aspx$/i, "") : item.name;

  return (
    <List.Item
      icon={FILE_ICONS[ext] ?? { source: Icon.Document, tintColor: Color.SecondaryText }}
      title={title}
      subtitle={showDetail ? undefined : location}
      accessories={
        showDetail
          ? undefined
          : [
              ...(modifiedBy ? [{ icon: Icon.Person, tooltip: modifiedBy }] : []),
              ...(item.lastModifiedDateTime
                ? [
                    {
                      date: new Date(item.lastModifiedDateTime),
                      tooltip: `Modified ${formatDate(item.lastModifiedDateTime)}${modifiedBy ? ` by ${modifiedBy}` : ""}`,
                    },
                  ]
                : []),
            ]
      }
      detail={
        <List.Item.Detail
          markdown={`## ${title}\n\n${formatSummary(hit.summary, true) || "_No preview available_"}`}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label title="Location" text={location || "-"} />
              {modifiedBy && <List.Item.Detail.Metadata.Label title="Modified By" text={modifiedBy} />}
              <List.Item.Detail.Metadata.Label title="Modified" text={formatDate(item.lastModifiedDateTime)} />
              {item.createdBy?.user?.displayName && (
                <List.Item.Detail.Metadata.Label title="Created By" text={item.createdBy.user.displayName} />
              )}
              <List.Item.Detail.Metadata.Label title="Created" text={formatDate(item.createdDateTime)} />
              {item.size !== undefined && <List.Item.Detail.Metadata.Label title="Size" text={formatSize(item.size)} />}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={item.webUrl} />
          {appUrl && (
            <Action.Open
              title="Open in Desktop App"
              icon={Icon.AppWindow}
              target={appUrl}
              shortcut={Keyboard.Shortcut.Common.Open}
            />
          )}
          <Action
            title={showDetail ? "Hide Preview" : "Show Preview"}
            icon={Icon.Sidebar}
            shortcut={primaryShortcut("y")}
            onAction={toggleDetail}
          />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Link" content={item.webUrl} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Markdown Link"
              content={`[${title}](${item.webUrl})`}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>{signOutAction}</ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function SiteItem({ hit, signOutAction }: { hit: SearchHit & { resource: SiteResource }; signOutAction: ReactNode }) {
  const site = hit.resource;
  const title = site.displayName || site.name || site.webUrl;
  return (
    <List.Item
      icon={{ source: Icon.House, tintColor: Color.Magenta }}
      title={title}
      subtitle={site.description || site.webUrl}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={site.webUrl} />
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Link" content={site.webUrl} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Markdown Link"
              content={`[${title}](${site.webUrl})`}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>{signOutAction}</ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function SignOutAction({ onSignedOut }: { onSignedOut: () => void }) {
  return (
    <Action
      title="Sign out"
      icon={Icon.Logout}
      style={Action.Style.Destructive}
      onAction={async () => {
        await signOut();
        await showToast({ style: Toast.Style.Success, title: "Signed out" });
        onSignedOut();
      }}
    />
  );
}
