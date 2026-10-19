import { Action, ActionPanel, Alert, confirmAlert, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { ReactNode, useEffect, useState } from "react";
import { verifyUnifiKey } from "./unifi";
import {
  changePassword,
  createVault,
  hasVault,
  isUnlocked,
  lockoutRemaining,
  replaceSecret,
  resetVault,
  unlock,
} from "./vault";

const MIN_PASSWORD = 8;

type State = "loading" | "setup" | "locked" | "open";
type Errors = Record<string, string | undefined>;

function passwordErrors(password: string, confirm: string): Errors {
  return {
    password: password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters` : undefined,
    confirm: password !== confirm ? "Passwords don't match" : undefined,
  };
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [errors, setErrors] = useState<Errors>({});
  const clear = (field: string) => () => setErrors((e) => ({ ...e, [field]: undefined }));
  return (
    <Form
      navigationTitle="Set Up LAPS Connect"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save and Unlock"
            icon={Icon.LockUnlocked}
            onSubmit={async (v: { apiKey: string; password: string; confirm: string }) => {
              const next = {
                apiKey: v.apiKey.trim() ? undefined : "Required",
                ...passwordErrors(v.password, v.confirm),
              };
              setErrors(next);
              if (Object.values(next).some(Boolean)) return;
              const toast = await showToast({ style: Toast.Style.Animated, title: "Checking UniFi API key…" });
              try {
                await verifyUnifiKey(v.apiKey);
                await createVault(v.apiKey.trim(), v.password);
                toast.style = Toast.Style.Success;
                toast.title = "LAPS Connect is set up";
                onDone();
              } catch (error) {
                toast.hide();
                await showFailureToast(error, { title: "Setup failed" });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Protection"
        text="LAPS Connect needs its own password. The UniFi API key is stored encrypted with it, and devices and LAPS passwords are only available after unlocking. It locks again automatically."
      />
      <Form.PasswordField
        id="apiKey"
        title="UniFi API Key"
        placeholder="Key of a view-only UniFi user"
        error={errors.apiKey}
        onChange={clear("apiKey")}
      />
      <Form.Separator />
      <Form.PasswordField
        id="password"
        title="Password"
        placeholder={`At least ${MIN_PASSWORD} characters`}
        error={errors.password}
        onChange={clear("password")}
      />
      <Form.PasswordField id="confirm" title="Repeat Password" error={errors.confirm} onChange={clear("confirm")} />
      <Form.Description text="There is no recovery: if you forget the password, reset and enter the UniFi API key again." />
    </Form>
  );
}

function UnlockForm({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const [error, setError] = useState<string>();
  return (
    <Form
      navigationTitle="LAPS Connect Locked"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Unlock"
            icon={Icon.LockUnlocked}
            onSubmit={async (v: { password: string }) => {
              const wait = await lockoutRemaining();
              if (wait > 0) return setError(`Too many attempts, try again in ${wait} s`);
              if (await unlock(v.password)) return onUnlocked();
              const after = await lockoutRemaining();
              setError(after > 0 ? `Too many attempts, try again in ${after} s` : "Wrong password");
            }}
          />
          <Action
            title="Reset (Forgot Password)"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: "Reset LAPS Connect?",
                  message: "The stored UniFi API key is deleted. You need to enter it again and choose a new password.",
                  primaryAction: { title: "Reset", style: Alert.ActionStyle.Destructive },
                })
              ) {
                await resetVault();
                onReset();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="🔒 Locked" text="Enter your LAPS Connect password to continue." />
      <Form.PasswordField id="password" title="Password" error={error} onChange={() => setError(undefined)} />
    </Form>
  );
}

export function ChangePasswordForm() {
  const { pop } = useNavigation();
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Form
      navigationTitle="Change LAPS Connect Password"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Change Password"
            icon={Icon.Key}
            onSubmit={async (v: { current: string; password: string; confirm: string }) => {
              const next = passwordErrors(v.password, v.confirm);
              setErrors(next);
              if (Object.values(next).some(Boolean)) return;
              if (await changePassword(v.current, v.password)) {
                await showToast({ title: "Password changed" });
                pop();
              } else setErrors({ current: "Wrong password" });
            }}
          />
        </ActionPanel>
      }
    >
      <Form.PasswordField id="current" title="Current Password" error={errors.current} />
      <Form.PasswordField id="password" title="New Password" error={errors.password} />
      <Form.PasswordField id="confirm" title="Repeat New Password" error={errors.confirm} />
    </Form>
  );
}

export function ReplaceUnifiKeyForm() {
  const { pop } = useNavigation();
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Form
      navigationTitle="Replace UniFi API Key"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Key"
            icon={Icon.Key}
            onSubmit={async (v: { password: string; apiKey: string }) => {
              try {
                await verifyUnifiKey(v.apiKey);
              } catch (error) {
                return setErrors({ apiKey: (error as Error).message });
              }
              if (await replaceSecret(v.password, v.apiKey.trim())) {
                await showToast({ title: "UniFi API key replaced" });
                pop();
              } else setErrors({ password: "Wrong password" });
            }}
          />
        </ActionPanel>
      }
    >
      <Form.PasswordField id="apiKey" title="New UniFi API Key" error={errors.apiKey} />
      <Form.PasswordField id="password" title="Your Password" error={errors.password} />
    </Form>
  );
}

/** Renders its children only while LAPS Connect is unlocked; re-checks every 15 s. */
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    (async () => {
      if (!(await hasVault())) setState("setup");
      else setState((await isUnlocked()) ? "open" : "locked");
    })();
    const timer = setInterval(async () => {
      if (!(await isUnlocked())) setState((s) => (s === "open" ? "locked" : s));
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  if (state === "loading") return <Form isLoading />;
  if (state === "setup") return <SetupForm onDone={() => setState("open")} />;
  if (state === "locked") return <UnlockForm onUnlocked={() => setState("open")} onReset={() => setState("setup")} />;
  return <>{children}</>;
}
