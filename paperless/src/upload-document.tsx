import { Action, ActionPanel, Form, getSelectedFinderItems, Icon, open, showToast, Toast } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { basename } from "node:path";
import { documentUrl, getTask, uploadDocument } from "./api";
import { useMeta } from "./components";
import { Gate } from "./gate";

interface Values {
  files: string[];
  title: string;
  created: Date | null;
  correspondent: string;
  documentType: string;
  tags: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until Paperless has consumed the upload; returns the new document id if known. */
async function waitForTask(taskId: string, toast: Toast): Promise<number | undefined> {
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const task = await getTask(taskId).catch(() => undefined);
    if (!task) continue;
    if (task.status === "SUCCESS") {
      const id = Number(task.related_document);
      return Number.isFinite(id) && id > 0 ? id : undefined;
    }
    if (task.status === "FAILURE" || task.status === "REVOKED") throw new Error(task.result ?? "Processing failed");
    toast.message = task.status === "STARTED" ? "Processing (OCR)…" : "Waiting in queue…";
  }
  throw new Error("Still processing after 3 minutes; check Paperless later");
}

function UploadDocumentView() {
  const { data: meta } = useMeta();
  // Files selected in Explorer / Finder are pre-filled.
  const { data: selected } = usePromise(async () => {
    try {
      return (await getSelectedFinderItems()).map((item) => item.path);
    } catch {
      return [];
    }
  });

  const submit = async (values: Values) => {
    if (values.files.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "Choose at least one file" });
      return;
    }
    const options = {
      title: values.files.length === 1 ? values.title.trim() || undefined : undefined,
      created: values.created ?? undefined,
      correspondent: values.correspondent ? Number(values.correspondent) : undefined,
      documentType: values.documentType ? Number(values.documentType) : undefined,
      tags: values.tags.map(Number),
    };
    const toast = await showToast({ style: Toast.Style.Animated, title: "Uploading…" });
    try {
      const tasks: string[] = [];
      for (const [i, file] of values.files.entries()) {
        toast.title = `Uploading ${i + 1}/${values.files.length}`;
        toast.message = basename(file);
        tasks.push(await uploadDocument(file, options));
      }
      toast.title =
        values.files.length === 1 ? "Uploaded, processing…" : `${values.files.length} files uploaded, processing…`;
      const ids: number[] = [];
      for (const task of tasks) {
        const id = await waitForTask(task, toast);
        if (id) ids.push(id);
      }
      toast.style = Toast.Style.Success;
      toast.title = values.files.length === 1 ? "Document added" : `${ids.length} documents added`;
      toast.message = undefined;
      if (ids.length > 0) {
        toast.primaryAction = { title: "Open in Paperless", onAction: () => open(documentUrl(ids[ids.length - 1])) };
      }
    } catch (error) {
      toast.hide();
      await showFailureToast(error, { title: "Upload failed" });
    }
  };

  const sorted = <T extends { name: string }>(items: Iterable<T>) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Form
      isLoading={!meta}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Upload" icon={Icon.Upload} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="files"
        title="Files"
        allowMultipleSelection
        canChooseDirectories={false}
        defaultValue={selected}
        key={(selected ?? []).join("|")}
      />
      <Form.Description text="Everything below is optional. Paperless fills in what you leave empty from its matching rules." />
      <Form.TextField id="title" title="Title" placeholder="Only used when uploading a single file" />
      <Form.DatePicker id="created" title="Created" type={Form.DatePicker.Type.Date} />
      <Form.Dropdown id="correspondent" title="Correspondent" defaultValue="">
        <Form.Dropdown.Item value="" title="Automatic" />
        {meta
          ? sorted(meta.correspondents.values()).map((c) => (
              <Form.Dropdown.Item key={c.id} value={String(c.id)} title={c.name} />
            ))
          : null}
      </Form.Dropdown>
      <Form.Dropdown id="documentType" title="Document Type" defaultValue="">
        <Form.Dropdown.Item value="" title="Automatic" />
        {meta
          ? sorted(meta.documentTypes.values()).map((t) => (
              <Form.Dropdown.Item key={t.id} value={String(t.id)} title={t.name} />
            ))
          : null}
      </Form.Dropdown>
      <Form.TagPicker id="tags" title="Tags">
        {meta
          ? sorted(meta.tags.values()).map((t) => (
              <Form.TagPicker.Item
                key={t.id}
                value={String(t.id)}
                title={t.name}
                icon={{ source: Icon.Tag, tintColor: t.color }}
              />
            ))
          : null}
      </Form.TagPicker>
    </Form>
  );
}

export default function UploadDocument() {
  return (
    <Gate>
      <UploadDocumentView />
    </Gate>
  );
}
