import { Action, ActionPanel, Color, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { signOut } from "./auth";

/** Form to send a message; `send` does the actual Graph call. */
export function MessageForm({ title, send }: { title: string; send: (text: string) => Promise<unknown> }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Message"
            icon={Icon.Envelope}
            onSubmit={async (values: { message: string }) => {
              const text = values.message.trim();
              if (!text) return;
              const toast = await showToast({ style: Toast.Style.Animated, title: "Sending…" });
              try {
                await send(text);
                toast.style = Toast.Style.Success;
                toast.title = "Message sent";
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Failed to send message";
                toast.message = (error as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="To" text={title} />
      <Form.TextArea id="message" title="Message" placeholder="Type your message…" autoFocus />
    </Form>
  );
}

export function SignOutAction({ onSignedOut }: { onSignedOut?: () => void }) {
  return (
    <Action
      title="Sign out"
      icon={Icon.Logout}
      style={Action.Style.Destructive}
      onAction={async () => {
        await signOut();
        await showToast({ style: Toast.Style.Success, title: "Signed out" });
        onSignedOut?.();
      }}
    />
  );
}

/** Persistent error view (toasts disappear too quickly to read Graph error messages). */
export function ErrorView({ error, retry }: { error: Error; retry: () => void }) {
  const permission = /insufficient privileges|access is denied|forbidden|consent|AADSTS65001/i.test(error.message);
  return (
    <List.EmptyView
      icon={{ source: Icon.Warning, tintColor: Color.Red }}
      title={permission ? "Missing permission" : "Request failed"}
      description={
        permission
          ? `${error.message}\n\nThe app registration probably lacks a permission or admin consent – see IT-SETUP.md.`
          : error.message
      }
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={retry} />
          <Action.CopyToClipboard title="Copy Error" content={error.message} />
          <SignOutAction onSignedOut={retry} />
        </ActionPanel>
      }
    />
  );
}
