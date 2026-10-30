import { Action, ActionPanel, Alert, Form, Icon, Toast, confirmAlert, popToRoot, showToast } from "@raycast/api";
import { FormValidation, useForm, usePromise } from "@raycast/utils";
import { useState } from "react";
import { dateTime } from "./lib/data";
import { DEFAULT_API_BASE, getToken } from "./lib/defender";
import { MIN_PASSWORD_LENGTH, deleteVault, saveVault, unlockVault, vaultInfo } from "./lib/vault";

type Info = NonNullable<Awaited<ReturnType<typeof vaultInfo>>>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const passwordRule = (v?: string) =>
  v && v.length < MIN_PASSWORD_LENGTH ? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen` : undefined;

// Sind schon Zugangsdaten hinterlegt, reicht zum Erneuern des Secrets bzw. Passworts ein kurzes Formular.
export default function Command() {
  const { data: info, isLoading } = usePromise(vaultInfo, []);
  if (isLoading) return <Form isLoading />;
  return info ? <Renew info={info} /> : <FullSetup info={null} />;
}

async function removeVault(info: Info) {
  if (
    !(await confirmAlert({
      title: "Zugangsdaten löschen?",
      message: `Die Zugangsdaten für „${info.tenantName}“ werden gelöscht. Vorhandene Reports bleiben erhalten.`,
      primaryAction: { title: "Löschen", style: Alert.ActionStyle.Destructive },
    }))
  )
    return;
  await deleteVault();
  await showToast({ style: Toast.Style.Success, title: "Zugangsdaten gelöscht" });
  await popToRoot();
}

interface RenewValues {
  currentPassword: string;
  clientSecret: string;
  newPassword: string;
  newPassword2: string;
}

function Renew({ info }: { info: Info }) {
  const [busy, setBusy] = useState(false);
  const { handleSubmit, itemProps, setValidationError } = useForm<RenewValues>({
    validation: { currentPassword: FormValidation.Required, newPassword: passwordRule },
    async onSubmit(v) {
      if (!v.clientSecret && !v.newPassword) {
        setValidationError("clientSecret", "Neues Secret oder neues Passwort angeben");
        return;
      }
      if (v.newPassword && v.newPassword !== v.newPassword2) {
        setValidationError("newPassword2", "Passwörter stimmen nicht überein");
        return;
      }
      setBusy(true);
      const toast = await showToast({ style: Toast.Style.Animated, title: "Entsperre …" });
      try {
        const creds = await unlockVault(v.currentPassword);
        if (v.clientSecret) {
          toast.title = "Prüfe neues Secret bei Microsoft …";
          creds.clientSecret = v.clientSecret.trim();
          await getToken(creds);
        }
        toast.title = "Verschlüssele …";
        await saveVault(creds, info.tenantName, v.newPassword || v.currentPassword);
        toast.style = Toast.Style.Success;
        toast.title =
          v.clientSecret && v.newPassword
            ? "Secret und Passwort geändert"
            : v.clientSecret
              ? "Secret erneuert"
              : "Passwort geändert";
        toast.message = v.clientSecret ? "Das alte Secret kann jetzt in Entra gelöscht werden." : undefined;
        await popToRoot();
      } catch (e) {
        toast.style = Toast.Style.Failure;
        toast.title = "Nicht gespeichert";
        toast.message = (e as Error).message;
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Form
      isLoading={busy}
      navigationTitle="Secret oder Passwort ändern"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Speichern" icon={Icon.Lock} onSubmit={handleSubmit} />
          <Action.Push title="Alle Zugangsdaten neu eingeben" icon={Icon.Pencil} target={<FullSetup info={info} />} />
          <Action
            title="Gespeicherte Zugangsdaten löschen"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={() => removeVault(info)}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Mandant" text={`${info.tenantName} · gespeichert am ${dateTime(info.created)}`} />
      <Form.PasswordField title="Aktuelles Report-Passwort" autoFocus {...itemProps.currentPassword} />
      <Form.Separator />
      <Form.PasswordField
        title="Neues Client-Secret"
        info="Den Wert (nicht die Secret-ID) aus Entra → App-Registrierung → Zertifikate & Geheimnisse. Leer lassen, wenn nur das Passwort geändert werden soll."
        {...itemProps.clientSecret}
      />
      <Form.PasswordField
        title="Neues Report-Passwort"
        info="Optional. Leer lassen, um das bisherige Passwort zu behalten."
        {...itemProps.newPassword}
      />
      <Form.PasswordField title="Neues Passwort wiederholen" {...itemProps.newPassword2} />
      <Form.Description text="Tenant-ID, Client-ID und API-Adresse bleiben unverändert. Ein neues Secret wird vor dem Speichern bei Microsoft geprüft." />
    </Form>
  );
}

interface Values {
  tenantName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  password: string;
  password2: string;
}

function FullSetup({ info }: { info: Info | null }) {
  const [busy, setBusy] = useState(false);
  const { handleSubmit, itemProps, setValidationError } = useForm<Values>({
    initialValues: { apiBaseUrl: DEFAULT_API_BASE, tenantName: info?.tenantName },
    validation: {
      tenantName: FormValidation.Required,
      tenantId: (v) => (!v ? "Pflichtfeld" : GUID.test(v.trim()) ? undefined : "Keine gültige GUID"),
      clientId: (v) => (!v ? "Pflichtfeld" : GUID.test(v.trim()) ? undefined : "Keine gültige GUID"),
      clientSecret: FormValidation.Required,
      apiBaseUrl: (v) => (!v || /^https:\/\/[^\s/]+/.test(v.trim()) ? undefined : "Muss mit https:// beginnen"),
      password: (v) => (!v ? "Pflichtfeld" : passwordRule(v)),
      password2: FormValidation.Required,
    },
    async onSubmit(v) {
      if (v.password !== v.password2) {
        setValidationError("password2", "Passwörter stimmen nicht überein");
        return;
      }
      if (
        info &&
        !(await confirmAlert({
          title: "Zugangsdaten ersetzen?",
          message: `Die gespeicherten Zugangsdaten für „${info.tenantName}“ werden überschrieben.`,
          primaryAction: { title: "Ersetzen", style: Alert.ActionStyle.Destructive },
        }))
      )
        return;
      const creds = {
        tenantId: v.tenantId.trim(),
        clientId: v.clientId.trim(),
        clientSecret: v.clientSecret.trim(),
        apiBaseUrl: (v.apiBaseUrl || DEFAULT_API_BASE).trim(),
      };
      setBusy(true);
      const toast = await showToast({ style: Toast.Style.Animated, title: "Prüfe Anmeldung bei Microsoft …" });
      try {
        await getToken(creds);
        toast.title = "Verschlüssele …";
        await saveVault(creds, v.tenantName.trim(), v.password);
        toast.style = Toast.Style.Success;
        toast.title = "Zugangsdaten verschlüsselt gespeichert";
        toast.message = "Report aktualisieren fragt ab jetzt nach diesem Passwort.";
        await popToRoot();
      } catch (e) {
        toast.style = Toast.Style.Failure;
        toast.title = "Nicht gespeichert";
        toast.message = (e as Error).message;
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Form
      isLoading={busy}
      navigationTitle="Defender-Zugangsdaten"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Prüfen und verschlüsselt speichern" icon={Icon.Lock} onSubmit={handleSubmit} />
          {info ? (
            <Action
              title="Gespeicherte Zugangsdaten löschen"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={() => removeVault(info)}
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.Description
        title="Status"
        text={
          info
            ? `Hinterlegt für „${info.tenantName}“ seit ${dateTime(info.created)}. Speichern ersetzt sie.`
            : "Noch keine Zugangsdaten hinterlegt."
        }
      />
      <Form.TextField title="Mandant (Anzeigename)" placeholder="z. B. Contoso GmbH" {...itemProps.tenantName} />
      <Form.TextField title="Tenant-ID" placeholder="00000000-0000-0000-0000-000000000000" {...itemProps.tenantId} />
      <Form.TextField
        title="Client-ID (App)"
        placeholder="00000000-0000-0000-0000-000000000000"
        {...itemProps.clientId}
      />
      <Form.PasswordField
        title="Client-Secret"
        info="Den Wert (nicht die Secret-ID) aus Entra → App-Registrierung → Zertifikate & Geheimnisse."
        {...itemProps.clientSecret}
      />
      <Form.TextField
        title="API-Adresse"
        info="Nur ändern, wenn ein regionaler Endpunkt nötig ist, z. B. https://eu.api.security.microsoft.com"
        {...itemProps.apiBaseUrl}
      />
      <Form.Separator />
      <Form.Description
        title="Report-Passwort"
        text={`Mit diesem Passwort werden die Zugangsdaten verschlüsselt (scrypt + AES-256-GCM). Es wird nicht gespeichert und bei jedem Report-Abruf abgefragt. Vergessen = Zugangsdaten neu eingeben. Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`}
      />
      <Form.PasswordField title="Passwort" {...itemProps.password} />
      <Form.PasswordField title="Passwort wiederholen" {...itemProps.password2} />
    </Form>
  );
}
