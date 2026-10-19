import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  Keyboard,
  List,
  open,
  showHUD,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, usePromise } from "@raycast/utils";
import { useMemo } from "react";
import {
  Document,
  documentUrl,
  downloadDocument,
  formatDate,
  highlightsToMarkdown,
  loadMeta,
  Meta,
  modifyTags,
  primaryShortcut,
  thumbnailPath,
  toMeta,
  updateDocument,
} from "./api";
import { ChangePasswordForm } from "./gate";
import { lock } from "./vault";

export function useMeta() {
  const result = useCachedPromise(loadMeta, [], { keepPreviousData: true });
  const data = useMemo(() => (result.data ? toMeta(result.data) : undefined), [result.data]);
  return { ...result, data };
}

function tagColor(color: string | undefined): Color.ColorLike {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : Color.SecondaryText;
}

function fileUrl(path: string): string {
  return encodeURI(`file:///${path.replace(/\\/g, "/")}`);
}

function DocumentDetail({ doc, meta }: { doc: Document; meta?: Meta }) {
  const { data: thumb } = usePromise(thumbnailPath, [doc.id, doc.modified]);
  const snippet = doc.__search_hit__?.highlights
    ? highlightsToMarkdown(doc.__search_hit__.highlights)
    : (doc.content ?? "").trim().slice(0, 700);
  const markdown = [
    thumb ? `![](${fileUrl(thumb)}?raycast-height=260)` : "",
    snippet ? `> ${snippet.replace(/\n+/g, "\n> ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const tags = doc.tags.map((id) => meta?.tags.get(id)).filter((t) => t !== undefined);

  return (
    <List.Item.Detail
      markdown={markdown || "_No preview_"}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Title" text={doc.title} />
          <List.Item.Detail.Metadata.Label title="Created" text={formatDate(doc.created)} />
          {doc.correspondent ? (
            <List.Item.Detail.Metadata.Label
              title="Correspondent"
              text={meta?.correspondents.get(doc.correspondent)?.name ?? `#${doc.correspondent}`}
            />
          ) : null}
          {doc.document_type ? (
            <List.Item.Detail.Metadata.Label
              title="Document Type"
              text={meta?.documentTypes.get(doc.document_type)?.name ?? `#${doc.document_type}`}
            />
          ) : null}
          {tags.length > 0 ? (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {tags.map((t) => (
                <List.Item.Detail.Metadata.TagList.Item key={t.id} text={t.name} color={tagColor(t.color)} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          ) : null}
          {doc.storage_path ? (
            <List.Item.Detail.Metadata.Label
              title="Storage Path"
              text={meta?.storagePaths.get(doc.storage_path)?.name ?? `#${doc.storage_path}`}
            />
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          {doc.archive_serial_number !== null ? (
            <List.Item.Detail.Metadata.Label title="ASN" text={String(doc.archive_serial_number)} />
          ) : null}
          {doc.page_count ? <List.Item.Detail.Metadata.Label title="Pages" text={String(doc.page_count)} /> : null}
          {doc.notes?.length ? <List.Item.Detail.Metadata.Label title="Notes" text={String(doc.notes.length)} /> : null}
          <List.Item.Detail.Metadata.Label title="Added" text={formatDate(doc.added)} />
          {doc.original_file_name ? (
            <List.Item.Detail.Metadata.Label title="Original File" text={doc.original_file_name} />
          ) : null}
          <List.Item.Detail.Metadata.Link title="Paperless" text={`Document ${doc.id}`} target={documentUrl(doc.id)} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function EditDocumentForm({ doc, meta, onSaved }: { doc: Document; meta: Meta; onSaved: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Edit ${doc.title}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            icon={Icon.Check}
            onSubmit={async (values: {
              title: string;
              created: Date | null;
              correspondent: string;
              documentType: string;
              tags: string[];
              asn: string;
            }) => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Saving…" });
              try {
                const asn = values.asn.trim();
                await updateDocument(doc.id, {
                  title: values.title.trim() || doc.title,
                  created: values.created ? values.created.toISOString().slice(0, 10) : doc.created,
                  correspondent: values.correspondent ? Number(values.correspondent) : null,
                  document_type: values.documentType ? Number(values.documentType) : null,
                  tags: values.tags.map(Number),
                  archive_serial_number: asn ? Number(asn) : null,
                });
                toast.style = Toast.Style.Success;
                toast.title = "Saved";
                onSaved();
                pop();
              } catch (error) {
                toast.hide();
                await showFailureToast(error, { title: "Could not save" });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" defaultValue={doc.title} />
      <Form.DatePicker
        id="created"
        title="Created"
        type={Form.DatePicker.Type.Date}
        defaultValue={new Date(doc.created)}
      />
      <Form.Dropdown
        id="correspondent"
        title="Correspondent"
        defaultValue={doc.correspondent ? String(doc.correspondent) : ""}
      >
        <Form.Dropdown.Item value="" title="None" />
        {[...meta.correspondents.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => (
            <Form.Dropdown.Item key={c.id} value={String(c.id)} title={c.name} />
          ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="documentType"
        title="Document Type"
        defaultValue={doc.document_type ? String(doc.document_type) : ""}
      >
        <Form.Dropdown.Item value="" title="None" />
        {[...meta.documentTypes.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => (
            <Form.Dropdown.Item key={t.id} value={String(t.id)} title={t.name} />
          ))}
      </Form.Dropdown>
      <Form.TagPicker id="tags" title="Tags" defaultValue={doc.tags.map(String)}>
        {[...meta.tags.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => (
            <Form.TagPicker.Item
              key={t.id}
              value={String(t.id)}
              title={t.name}
              icon={{ source: Icon.Tag, tintColor: tagColor(t.color) }}
            />
          ))}
      </Form.TagPicker>
      <Form.TextField
        id="asn"
        title="Archive Serial Number"
        defaultValue={doc.archive_serial_number !== null ? String(doc.archive_serial_number) : ""}
      />
    </Form>
  );
}

async function download(doc: Document, original: boolean, then: "open" | "show") {
  const toast = await showToast({ style: Toast.Style.Animated, title: `Downloading ${doc.title}…` });
  try {
    const path = await downloadDocument(doc, original);
    toast.style = Toast.Style.Success;
    toast.title = "Downloaded";
    toast.message = path;
    if (then === "open") await open(path);
    else await showInFinder(path);
  } catch (error) {
    toast.hide();
    await showFailureToast(error, { title: "Download failed" });
  }
}

export interface DocumentItemProps {
  doc: Document;
  meta?: Meta;
  showingDetail: boolean;
  toggleDetail: () => void;
  onChanged: () => void;
  inboxTags?: number[];
  onMoreLikeThis?: (doc: Document) => void;
}

export function DocumentItem({
  doc,
  meta,
  showingDetail,
  toggleDetail,
  onChanged,
  inboxTags,
  onMoreLikeThis,
}: DocumentItemProps) {
  const url = documentUrl(doc.id);
  const correspondent = doc.correspondent ? meta?.correspondents.get(doc.correspondent)?.name : undefined;
  const type = doc.document_type ? meta?.documentTypes.get(doc.document_type)?.name : undefined;
  const inInbox = inboxTags?.some((t) => doc.tags.includes(t));

  return (
    <List.Item
      icon={inInbox ? { source: Icon.Tray, tintColor: Color.Orange } : Icon.Document}
      title={doc.title}
      subtitle={showingDetail ? undefined : correspondent}
      keywords={[correspondent ?? "", type ?? ""]}
      accessories={
        showingDetail
          ? undefined
          : [
              ...(type ? [{ tag: { value: type, color: Color.Blue } }] : []),
              { date: new Date(doc.created), tooltip: `Created ${formatDate(doc.created)}` },
            ]
      }
      detail={showingDetail ? <DocumentDetail doc={doc} meta={meta} /> : undefined}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={url} />
          <Action
            title="Download and Open"
            icon={Icon.Download}
            shortcut={primaryShortcut("o")}
            onAction={() => download(doc, false, "open")}
          />
          <Action
            title={showingDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={primaryShortcut("d")}
            onAction={toggleDetail}
          />
          <ActionPanel.Section>
            {meta ? (
              <Action.Push
                title="Edit Document"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<EditDocumentForm doc={doc} meta={meta} onSaved={onChanged} />}
              />
            ) : null}
            {inInbox && inboxTags ? (
              <Action
                title="Remove from Inbox"
                icon={Icon.CheckCircle}
                shortcut={primaryShortcut("i", true)}
                onAction={async () => {
                  try {
                    await modifyTags([doc.id], [], inboxTags);
                    await showToast({ title: "Removed from inbox", message: doc.title });
                    onChanged();
                  } catch (error) {
                    await showFailureToast(error, { title: "Could not update tags" });
                  }
                }}
              />
            ) : null}
            {onMoreLikeThis ? (
              <Action
                title="Show Similar Documents"
                icon={Icon.MagnifyingGlass}
                shortcut={primaryShortcut("m", true)}
                onAction={() => onMoreLikeThis(doc)}
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action title="Download Original" icon={Icon.Download} onAction={() => download(doc, true, "show")} />
            <Action
              title="Download and Show in Folder"
              icon={Icon.Finder}
              onAction={() => download(doc, false, "show")}
            />
            <Action.CopyToClipboard title="Copy Link" content={url} shortcut={Keyboard.Shortcut.Common.Copy} />
            <Action.CopyToClipboard
              title="Copy Title"
              content={doc.title}
              shortcut={Keyboard.Shortcut.Common.CopyName}
            />
            {doc.archive_serial_number !== null ? (
              <Action.CopyToClipboard title="Copy ASN" content={String(doc.archive_serial_number)} />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section title="Security">
            <Action
              title="Lock Paperless"
              icon={Icon.Lock}
              shortcut={primaryShortcut("l")}
              onAction={async () => {
                await lock();
                await showHUD("🔒 Paperless locked");
              }}
            />
            <Action.Push title="Change Password" icon={Icon.Key} target={<ChangePasswordForm />} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
