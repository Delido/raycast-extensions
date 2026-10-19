import { Action, ActionPanel, Alert, confirmAlert, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { ReactNode, useEffect, useState } from "react";
import { serverUrl, verifyToken } from "./api";
import { changePassword, createVault, hasVault, isUnlocked, lockoutRemaining, resetVault, unlock } from "./vault";

const MIN_PASSWORD = 6;

type State = "loading" | "setup" | "locked" | "open";

function SetupForm({ onDone }: { onDone: () => void }) {
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <Form
      navigationTitle="Set Up Paperless"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save and Unlock"
            icon={Icon.LockUnlocked}
            onSubmit={async (v: { token: string; password: string; confirm: string }) => {
              const next: Record<string, string | undefined> = {};
              if (!v.token.trim()) next.token = "Required";
              if (v.password.length < MIN_PASSWORD) next.password = `At least ${MIN_PASSWORD} characters`;
              if (v.password !== v.confirm) next.confirm = "Passwords don't match";
              setErrors(next);
              if (Object.values(next).some(Boolean)) return;
              const toast = await showToast({ style: Toast.Style.Animated, title: "Checking token…" });
              try {
                await verifyToken(v.token);
                await createVault(v.token.trim(), v.password);
                toast.style = Toast.Style.Success;
                toast.title = "Paperless is set up";
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
        text={`Your API token is stored encrypted with a password of your choice. Paperless content in Raycast is only accessible after unlocking, and locks again automatically.\n\nServer: ${serverUrl()}`}
      />
      <Form.PasswordField
        id="token"
        title="API Token"
        placeholder="Paperless: My Profile → API Auth Token"
        error={errors.token}
        onChange={() => setErrors((e) => ({ ...e, token: undefined }))}
      />
      <Form.Separator />
      <Form.PasswordField
        id="password"
        title="Password"
        placeholder={`At least ${MIN_PASSWORD} characters`}
        error={errors.password}
        onChange={() => setErrors((e) => ({ ...e, password: undefined }))}
      />
      <Form.PasswordField
        id="confirm"
        title="Repeat Password"
        error={errors.confirm}
        onChange={() => setErrors((e) => ({ ...e, confirm: undefined }))}
      />
      <Form.Description text="There is no recovery: if you forget the password, reset and enter a new API token." />
    </Form>
  );
}

function UnlockForm({ onUnlocked, onReset }: { onUnlocked: () => void; onReset: () => void }) {
  const [error, setError] = useState<string>();
  return (
    <Form
      navigationTitle="Paperless Locked"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Unlock"
            icon={Icon.LockUnlocked}
            onSubmit={async (v: { password: string }) => {
              const wait = await lockoutRemaining();
              if (wait > 0) {
                setError(`Too many attempts, try again in ${wait} s`);
                return;
              }
              if (await unlock(v.password)) onUnlocked();
              else {
                const after = await lockoutRemaining();
                setError(after > 0 ? `Too many attempts, try again in ${after} s` : "Wrong password");
              }
            }}
          />
          <Action
            title="Reset (Forgot Password)"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (
                await confirmAlert({
                  title: "Reset Paperless access?",
                  message: "The stored token is deleted. You need to enter an API token and choose a new password.",
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
      <Form.Description title="🔒 Locked" text="Enter your Paperless password to continue." />
      <Form.PasswordField id="password" title="Password" error={error} onChange={() => setError(undefined)} />
    </Form>
  );
}

export function ChangePasswordForm() {
  const { pop } = useNavigation();
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <Form
      navigationTitle="Change Paperless Password"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Change Password"
            icon={Icon.Key}
            onSubmit={async (v: { current: string; password: string; confirm: string }) => {
              const next: Record<string, string | undefined> = {};
              if (v.password.length < MIN_PASSWORD) next.password = `At least ${MIN_PASSWORD} characters`;
              if (v.password !== v.confirm) next.confirm = "Passwords don't match";
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

/** Renders its children only while Paperless is unlocked; re-checks every 20 s. */
export function Gate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("loading");

  const check = async () => {
    if (!(await hasVault())) setState("setup");
    else setState((await isUnlocked()) ? "open" : "locked");
  };

  useEffect(() => {
    check();
    const timer = setInterval(async () => {
      if (!(await isUnlocked())) setState((s) => (s === "open" ? "locked" : s));
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  if (state === "loading") return <Form isLoading />;
  if (state === "setup") return <SetupForm onDone={() => setState("open")} />;
  if (state === "locked") return <UnlockForm onUnlocked={() => setState("open")} onReset={() => setState("setup")} />;
  return <>{children}</>;
}
