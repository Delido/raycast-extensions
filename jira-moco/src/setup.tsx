import { Action, ActionPanel, Color, Form, Icon, List, showToast, Toast, useNavigation, Keyboard } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  Config,
  isComplete,
  loadConfig,
  mocoUrl,
  normalizeJiraSite,
  normalizeMocoDomain,
  saveConfig,
} from "./lib/config";
import { getFields, getMyself, searchIssues } from "./lib/jira";
import { matchIssue } from "./lib/match";
import { getAssignedProjects, getSession, login } from "./lib/moco";

type StepState = "done" | "todo" | "failed";

const ICONS: Record<StepState, { source: Icon; tintColor: Color }> = {
  done: { source: Icon.CheckCircle, tintColor: Color.Green },
  todo: { source: Icon.Circle, tintColor: Color.SecondaryText },
  failed: { source: Icon.XMarkCircle, tintColor: Color.Red },
};

const escapeCell = (s: string | undefined) => (s ?? "–").replace(/\|/g, "/").replace(/\n/g, " ");

/** Recently viewed issues and what the extension makes of them: the live check of step 4. */
async function runTest(config: Config) {
  const [issues, projects] = await Promise.all([searchIssues(config, ""), getAssignedProjects(config.moco!)]);
  const rows = await Promise.all(
    issues.slice(0, 10).map(async (issue) => ({ issue, m: await matchIssue(issue, projects) })),
  );
  return { rows, projects: projects.length };
}

export default function Command() {
  return <Setup />;
}

export function Setup({ onDone }: { onDone?: () => void }) {
  const { data: config, revalidate, isLoading } = usePromise(loadConfig);
  const complete = !!config && isComplete(config);
  const test = usePromise(runTest, [config!], { execute: complete, onError: () => undefined });

  const refresh = () => {
    revalidate();
    if (complete) test.revalidate();
  };

  const jiraDone = !!config?.jira;
  const fieldsDone = !!config?.jobField;
  const mocoDone = !!config?.moco;
  const rows = test.data?.rows ?? [];
  const found = rows.filter((r) => r.m.project && r.m.task).length;

  const table = rows.length
    ? [
        "| Issue | Job | Order | MOCO project | Task |",
        "|---|---|---|---|---|",
        ...rows.map(
          ({ issue, m }) =>
            `| ${issue.key} | ${escapeCell(m.job)} | ${escapeCell(m.order)} | ${m.project ? `✅ ${escapeCell(m.project.identifier)}` : m.job ? "❌ not found" : "–"} | ${m.task ? `✅ ${escapeCell(m.task.name)}` : m.project ? "❌ choose when booking" : "–"} |`,
        ),
      ].join("\n")
    : "";

  const steps = [
    {
      id: "jira",
      title: "Connect Jira Cloud",
      state: (jiraDone ? "done" : "todo") as StepState,
      subtitle: config?.jira
        ? `${config.jira.displayName ?? config.jira.email} · ${config.jira.site.replace(/^https:\/\//, "")}`
        : undefined,
      markdown: `## 1. Connect Jira Cloud

You need your Jira address, your Atlassian email and an **API token**:

1. **Create API Token** (Ctrl/Cmd+O) opens your Atlassian account.
2. Click **Create API token**, give it a name like *Raycast* and copy it.
3. **Connect Jira** (Enter) and paste it there.

The token only gets the rights your Jira user has. Worklogs are booked in your name.`,
      actions: (
        <>
          <Action.Push title="Connect Jira" icon={Icon.Plug} target={<JiraForm config={config} onSaved={refresh} />} />
          <Action.OpenInBrowser
            title="Create API Token"
            url="https://id.atlassian.com/manage-profile/security/api-tokens"
            shortcut={Keyboard.Shortcut.Common.Open}
          />
        </>
      ),
    },
    {
      id: "fields",
      title: "Choose job and order fields",
      state: (fieldsDone ? "done" : "todo") as StepState,
      subtitle: config?.jobField
        ? `${config.jobField.name}${config.orderField ? ` + ${config.orderField.name}` : ""}`
        : undefined,
      markdown: `## 2. Choose the fields

Tell the extension which Jira fields hold the **job number** and the **order**:

- **Job number** is compared with the project number (*identifier*) of your MOCO projects, e.g. *P1234*.
- **Order** is compared with the task names of that project.

If the job number is part of another field (e.g. the summary *"[P1234] Website"*), choose that field and set a **Job Number Pattern** in the extension settings, e.g. \`\\[(\\w+)\\]\`.

Step 4 shows right away what the extension reads from your recent issues.`,
      actions: jiraDone ? (
        <Action.Push
          title="Choose Fields"
          icon={Icon.List}
          target={<FieldsForm config={config!} onSaved={refresh} />}
        />
      ) : null,
    },
    {
      id: "moco",
      title: "Connect MOCO",
      state: (mocoDone ? "done" : "todo") as StepState,
      subtitle: config?.moco ? `${config.moco.domain}.mocoapp.com` : undefined,
      markdown: `## 3. Connect MOCO

**Connect MOCO** (Enter) asks for your MOCO address (e.g. *example* for example.mocoapp.com) and either

- your **MOCO email and password**: the extension fetches your personal API key and stores only that key, not the password, or
- your **API key**, if you sign in to MOCO with Google or Microsoft: MOCO → your profile → **Integrations**.

Activities are booked in your name, with a link back to the Jira issue.`,
      actions: (
        <Action.Push title="Connect MOCO" icon={Icon.Plug} target={<MocoForm config={config} onSaved={refresh} />} />
      ),
    },
    {
      id: "test",
      title: "Test with your recent issues",
      state: (test.error ? "failed" : complete && rows.length ? "done" : "todo") as StepState,
      subtitle: test.error
        ? test.error.message
        : complete
          ? rows.length
            ? `${found} of ${rows.length} recent issues fully found in MOCO`
            : test.isLoading
              ? "Checking…"
              : "No recently viewed issues"
          : undefined,
      markdown: `## 4. Test

${
  !complete
    ? "Finish steps 1 to 3 first."
    : test.error
      ? `**Failed:** ${test.error.message}`
      : rows.length
        ? `These are the issues you viewed last in Jira, and what would be booked in MOCO (${test.data?.projects ?? 0} projects assigned to you):\n\n${table}\n\nAn issue without a match is fine: when booking you choose project and task once, and the extension remembers it for that issue.`
        : test.isLoading
          ? "Reading your recent issues…"
          : "Open a few issues in Jira, then **Refresh**."
}

When this looks right, you're done: open **Track Time**.`,
      actions: complete ? (
        <>
          {onDone ? <Action title="Done" icon={Icon.Check} onAction={onDone} /> : null}
          <Action title="Run Test Again" icon={Icon.RotateClockwise} onAction={() => test.revalidate()} />
        </>
      ) : null,
    },
  ];

  return (
    <List
      isLoading={isLoading || test.isLoading}
      isShowingDetail
      navigationTitle="Set Up Jira and MOCO"
      selectedItemId={steps.find((s) => s.state !== "done")?.id}
    >
      {steps.map((step) => (
        <List.Item
          key={step.id}
          id={step.id}
          icon={ICONS[step.state]}
          title={step.title}
          subtitle={step.subtitle}
          detail={<List.Item.Detail markdown={step.markdown} />}
          actions={
            <ActionPanel>
              {step.actions}
              <Action
                title="Refresh"
                icon={Icon.RotateClockwise}
                onAction={refresh}
                shortcut={Keyboard.Shortcut.Common.Refresh}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function JiraForm({ config, onSaved }: { config?: Config; onSaved: () => void }) {
  const { pop } = useNavigation();
  const submit = async (values: { site: string; email: string; token: string }) => {
    if (!values.site.trim() || !values.email.trim() || !values.token.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Fill in all three fields" });
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: "Checking Jira…" });
    try {
      const jira = { site: normalizeJiraSite(values.site), email: values.email.trim(), token: values.token.trim() };
      const me = await getMyself(jira);
      await saveConfig({ jira: { ...jira, accountId: me.accountId, displayName: me.displayName } });
      toast.style = Toast.Style.Success;
      toast.title = `Connected as ${me.displayName}`;
      onSaved();
      pop();
    } catch (error) {
      toast.hide();
      await showFailureToast(error, { title: "Jira connection failed" });
    }
  };
  return (
    <Form
      navigationTitle="Connect Jira"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Connect" icon={Icon.Plug} onSubmit={submit} />
          <Action.OpenInBrowser
            title="Create API Token"
            url="https://id.atlassian.com/manage-profile/security/api-tokens"
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="site"
        title="Jira Address"
        placeholder="example.atlassian.net"
        defaultValue={config?.jira?.site.replace(/^https:\/\//, "")}
      />
      <Form.TextField id="email" title="Email" placeholder="you@example.com" defaultValue={config?.jira?.email} />
      <Form.PasswordField id="token" title="API Token" defaultValue={config?.jira?.token} />
      <Form.Description text="Create the token at id.atlassian.com → Security → API tokens (action in the menu)." />
    </Form>
  );
}

function FieldsForm({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const { pop } = useNavigation();
  const { data: fields = [], isLoading } = usePromise(() => getFields(config.jira!), [], {
    onError: (error) => void showFailureToast(error, { title: "Can't load Jira fields" }),
  });
  const guess = (re: RegExp) => fields.find((f) => f.custom && re.test(f.name))?.id ?? "";
  const [job, setJob] = useState<string>();
  const [order, setOrder] = useState<string>();
  const jobValue = job ?? config.jobField?.id ?? guess(/job/i);
  const orderValue = order ?? config.orderField?.id ?? guess(/auftrag|order|leistung/i);

  const submit = async () => {
    const jobField = fields.find((f) => f.id === jobValue);
    if (!jobField) {
      await showToast({ style: Toast.Style.Failure, title: "Choose the job number field" });
      return;
    }
    const orderField = fields.find((f) => f.id === orderValue);
    await saveConfig({
      jobField: { id: jobField.id, name: jobField.name },
      orderField: orderField ? { id: orderField.id, name: orderField.name } : undefined,
    });
    await showToast({ style: Toast.Style.Success, title: "Fields saved" });
    onSaved();
    pop();
  };

  const items = fields.map((f) => (
    <Form.Dropdown.Item
      key={f.id}
      value={f.id}
      title={f.name}
      icon={f.custom ? Icon.Tag : Icon.Document}
      keywords={[f.id]}
    />
  ));

  return (
    <Form
      navigationTitle="Choose Fields"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Fields" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Type to search. Custom fields have a tag icon, Jira's own fields (like Summary) a page icon." />
      {fields.length ? (
        <>
          <Form.Dropdown id="job" title="Job Number" value={jobValue} onChange={setJob}>
            <Form.Dropdown.Item value="" title="Choose a field…" />
            {items}
          </Form.Dropdown>
          <Form.Dropdown id="order" title="Order (optional)" value={orderValue} onChange={setOrder}>
            <Form.Dropdown.Item value="" title="None: choose the MOCO task when booking" />
            {items}
          </Form.Dropdown>
        </>
      ) : null}
    </Form>
  );
}

function MocoForm({ config, onSaved }: { config?: Config; onSaved: () => void }) {
  const { pop } = useNavigation();
  const [method, setMethod] = useState<string>(config?.moco ? "key" : "login");
  const [domain, setDomain] = useState(config?.moco?.domain ?? "");

  const submit = async (values: { domain: string; email?: string; password?: string; apiKey?: string }) => {
    const d = normalizeMocoDomain(values.domain);
    if (!d) {
      await showToast({ style: Toast.Style.Failure, title: "Enter your MOCO address" });
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: "Checking MOCO…" });
    try {
      let apiKey = values.apiKey?.trim() ?? "";
      if (method === "login") {
        if (!values.email?.trim() || !values.password) throw new Error("Enter email and password");
        apiKey = (await login(d, values.email.trim(), values.password)).apiKey;
      }
      if (!apiKey) throw new Error("Enter the API key");
      const session = await getSession({ domain: d, apiKey });
      const projects = await getAssignedProjects({ domain: d, apiKey, userId: session.id });
      await saveConfig({ moco: { domain: d, apiKey, userId: session.id } });
      toast.style = Toast.Style.Success;
      toast.title = `MOCO connected: ${projects.length} projects assigned to you`;
      onSaved();
      pop();
    } catch (error) {
      toast.hide();
      await showFailureToast(error, { title: "MOCO connection failed" });
    }
  };

  const d = normalizeMocoDomain(domain);
  return (
    <Form
      navigationTitle="Connect MOCO"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Connect" icon={Icon.Plug} onSubmit={submit} />
          {d ? (
            <Action.OpenInBrowser
              title="Open MOCO Profile"
              url={mocoUrl({ moco: { domain: d, apiKey: "" } }, "/profile")}
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.TextField
        id="domain"
        title="MOCO Address"
        placeholder="example.mocoapp.com"
        value={domain}
        onChange={setDomain}
      />
      <Form.Dropdown id="method" title="Sign In With" value={method} onChange={setMethod}>
        <Form.Dropdown.Item value="login" title="MOCO email and password" />
        <Form.Dropdown.Item value="key" title="API key (for Google or Microsoft sign-in)" />
      </Form.Dropdown>
      {method === "login" ? (
        <>
          <Form.TextField id="email" title="Email" placeholder="you@example.com" />
          <Form.PasswordField id="password" title="Password" info="Used once to fetch your API key, not stored" />
        </>
      ) : (
        <>
          <Form.PasswordField id="apiKey" title="API Key" defaultValue={config?.moco?.apiKey} />
          <Form.Description text="MOCO → your profile → Integrations → personal API key." />
        </>
      )}
    </Form>
  );
}
