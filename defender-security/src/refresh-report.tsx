import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  LaunchType,
  Toast,
  launchCommand,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { openReport, prefs } from "./lib/data";
import { generateReport } from "./lib/report";
import { Credentials, unlockVault, vaultInfo } from "./lib/vault";

export default function Command() {
  const { data: info, isLoading } = usePromise(vaultInfo, []);
  if (prefs().demoMode) return <Progress tenantName="Demo-Mandant" demo />;
  if (isLoading) return <Form isLoading />;
  if (!info) {
    return (
      <Detail
        markdown={
          "# Keine Zugangsdaten\n\nZuerst mit **„Defender-Zugangsdaten verwalten“** Tenant-ID, Client-ID, Secret und ein Report-Passwort hinterlegen."
        }
        actions={
          <ActionPanel>
            <Action
              title="Zugangsdaten einrichten"
              icon={Icon.Lock}
              onAction={() => launchCommand({ name: "setup-credentials", type: LaunchType.UserInitiated })}
            />
          </ActionPanel>
        }
      />
    );
  }
  return <Unlock tenantName={info.tenantName} />;
}

function Unlock({ tenantName }: { tenantName: string }) {
  const { push } = useNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit({ password }: { password: string }) {
    setBusy(true);
    setError(undefined);
    try {
      const creds = await unlockVault(password);
      push(<Progress tenantName={tenantName} creds={creds} />);
    } catch (e) {
      setError((e as Error).message);
      await showToast({ style: Toast.Style.Failure, title: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form
      isLoading={busy}
      navigationTitle="Report aktualisieren"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Entsperren und Report erzeugen" icon={Icon.LockUnlocked} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Mandant" text={tenantName} />
      <Form.PasswordField
        id="password"
        title="Report-Passwort"
        autoFocus
        error={error}
        onChange={() => setError(undefined)}
      />
    </Form>
  );
}

type Status = "running" | "done" | "error";

function Progress({ tenantName, creds, demo = false }: { tenantName: string; creds?: Credentials; demo?: boolean }) {
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("running");
  const started = useRef(false);

  useEffect(() => {
    // Im Entwicklungsmodus führt React Effekte doppelt aus (StrictMode); ohne Sperre liefe der Abruf zweimal parallel.
    if (started.current) return;
    started.current = true;
    const append = (line: string) => setLog((l) => [...l, line]);
    (async () => {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: demo ? "Erzeuge Demo-Report …" : "Report wird aktualisiert …",
      });
      try {
        const res = await generateReport({ creds, tenantName, demo, log: append });
        setStatus("done");
        toast.style = Toast.Style.Success;
        toast.title = "Report aktualisiert";
        toast.message = `${res.findings.toLocaleString("de-DE")} Funde`;
        toast.primaryAction = { title: "Report öffnen", onAction: () => openReport() };
      } catch (e) {
        append(`\n❌ ${(e as Error).message}`);
        setStatus("error");
        toast.style = Toast.Style.Failure;
        toast.title = "Aktualisierung fehlgeschlagen";
        toast.message = (e as Error).message;
      }
    })();
  }, []);

  const heading =
    status === "running"
      ? "⏳ Report wird aktualisiert …"
      : status === "done"
        ? "✅ Report aktualisiert"
        : "❌ Aktualisierung fehlgeschlagen";
  const hint = status === "running" ? "\n\nBitte das Fenster offen lassen, bis der Lauf fertig ist." : "";
  const text = log.join("\n");
  return (
    <Detail
      isLoading={status === "running"}
      navigationTitle={demo ? "Demo-Report" : tenantName}
      markdown={`# ${heading}${hint}${demo ? "\n\n_Demomodus: Es werden Beispieldaten verwendet, keine Verbindung zu Defender._" : ""}\n\n\`\`\`\n${text || "Starte …"}\n\`\`\``}
      actions={
        <ActionPanel>
          {status === "done" ? (
            <>
              <Action title="Report öffnen" icon={Icon.Globe} onAction={() => openReport()} />
              <Action
                title="Top-Maßnahmen anzeigen"
                icon={Icon.List}
                onAction={() => launchCommand({ name: "top-actions", type: LaunchType.UserInitiated })}
              />
            </>
          ) : null}
          <Action.CopyToClipboard title="Protokoll kopieren" content={text} />
        </ActionPanel>
      }
    />
  );
}
