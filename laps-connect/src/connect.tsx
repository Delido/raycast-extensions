import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  Detail,
  Form,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getLapsPassword, LapsCredential, signOut } from "./lib/graph";
import { copySecret, startRdp } from "./lib/secure";
import { freePort, openInTerminal, safeArg, waitForPort } from "./lib/terminal";
import { ChangePasswordForm, Gate, ReplaceUnifiKeyForm } from "./lib/gate";
import { getWireGuardUsers, WireGuardUser } from "./lib/unifi";
import { lock } from "./lib/vault";

function prefs() {
  const p = getPreferenceValues<Preferences>();
  let filter: RegExp;
  try {
    filter = new RegExp(p.nameFilter?.trim() || "^.-[^-]+$", "i");
  } catch {
    throw new Error(`Invalid WireGuard name filter: ${p.nameFilter}`);
  }
  return { ...p, filter, suffix: p.deviceSuffix?.trim() ?? "-LAP", jump: p.jumpHost?.trim() || undefined };
}

const deviceName = (user: WireGuardUser) => `${user.name}${prefs().suffix}`.toUpperCase();
const jumpArgs = () => (prefs().jump ? ["-J", safeArg(prefs().jump!)] : []);

async function withLaps(user: WireGuardUser, use: (cred: LapsCredential) => Promise<void>) {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Fetching LAPS password for ${deviceName(user)}…`,
  });
  try {
    const cred = await getLapsPassword(deviceName(user));
    toast.hide();
    await use(cred);
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "LAPS Connect failed";
    toast.message = (error as Error).message;
  }
}

/** SSH as the LAPS account; the password goes to the clipboard (no history, auto-clear). */
async function sshWithLaps(user: WireGuardUser) {
  await withLaps(user, async (cred) => {
    const seconds = await copySecret(cred.password);
    await closeMainWindow({ clearRootSearch: true });
    await openInTerminal(cred.deviceName, [
      "ssh",
      ...jumpArgs(),
      // known_hosts entry follows the device, not the (reassignable) WireGuard IP
      "-o",
      `HostKeyAlias=${cred.deviceName}`,
      "-o",
      "PreferredAuthentications=keyboard-interactive,password",
      "-l",
      cred.accountName,
      user.ip,
    ]);
    await showHUD(`LAPS password on clipboard for ${seconds}s – right-click to paste`);
  });
}

/** SSH with your own login (no LAPS), e.g. for Mac/Linux devices. */
async function sshOwnLogin(user: WireGuardUser) {
  await closeMainWindow({ clearRootSearch: true });
  await openInTerminal(user.name, ["ssh", ...jumpArgs(), "-o", `HostKeyAlias=${deviceName(user)}`, user.ip]);
}

/** SSH with any other account (e.g. a local admin or DOMAIN\user); the password is asked in the terminal. */
async function sshAsUser(user: WireGuardUser, login: string) {
  await closeMainWindow({ clearRootSearch: true });
  await openInTerminal(user.name, [
    "ssh",
    ...jumpArgs(),
    "-o",
    `HostKeyAlias=${deviceName(user)}`,
    "-l",
    safeArg(login),
    user.ip,
  ]);
}

function SshAsUserForm({ user }: { user: WireGuardUser }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`SSH to ${deviceName(user)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Connect"
            icon={Icon.Terminal}
            onSubmit={async ({ login }: { login: string }) => {
              const name = login.trim();
              if (!name) {
                await showToast({ style: Toast.Style.Failure, title: "Enter a user name" });
                return;
              }
              try {
                await sshAsUser(user, name);
                pop();
              } catch (error) {
                await showToast({ style: Toast.Style.Failure, title: "SSH failed", message: (error as Error).message });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="login"
        title="User Name"
        placeholder="admin, DOMAIN\user or user@domain"
        info="The password is asked in the terminal"
        storeValue
        autoFocus
      />
      <Form.Description text={`${user.ip} (${deviceName(user)})`} />
    </Form>
  );
}

/** RDP with the LAPS account; via the jump host a local SSH tunnel is opened first. */
async function rdpWithLaps(user: WireGuardUser) {
  await withLaps(user, async (cred) => {
    let address = user.ip;
    const { jump } = prefs();
    if (jump) {
      const port = await freePort();
      await openInTerminal(`RDP tunnel ${cred.deviceName}`, [
        "ssh",
        "-N",
        "-o",
        "ExitOnForwardFailure=yes",
        "-L",
        `127.0.0.1:${port}:${user.ip}:3389`,
        safeArg(jump),
      ]);
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "Waiting for RDP tunnel…",
        message: "Log in to the jump host in the terminal tab if asked",
      });
      if (!(await waitForPort(port))) {
        toast.style = Toast.Style.Failure;
        toast.title = "RDP tunnel did not come up";
        return;
      }
      toast.hide();
      address = `127.0.0.1:${port}`;
    }
    await startRdp(address, `.\\${cred.accountName}`, cred.password);
    await closeMainWindow({ clearRootSearch: true });
  });
}

function PasswordDetail({ user }: { user: WireGuardUser }) {
  const { data, isLoading, error } = usePromise((u: WireGuardUser) => getLapsPassword(deviceName(u)), [user]);
  const markdown = error
    ? `**Error:** ${error.message}`
    : data
      ? [
          `# ${data.deviceName}`,
          "",
          "| | |",
          "|---|---|",
          `| Account | \`${data.accountName}\` |`,
          `| Password | \`${data.password.replace(/`/g, "ˋ")}\` |`,
          `| Backed up | ${data.backupDateTime ? new Date(data.backupDateTime).toLocaleString() : "-"} |`,
          "",
          "_This retrieval is recorded in the Entra audit log. Close this view when done._",
        ].join("\n")
      : "";
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`LAPS ${deviceName(user)}`}
      markdown={markdown}
      actions={
        data && (
          <ActionPanel>
            <Action
              title="Copy Password (Auto-Clear)"
              icon={Icon.Clipboard}
              onAction={async () => {
                const s = await copySecret(data.password);
                await showHUD(`Password on clipboard for ${s}s`);
              }}
            />
            <Action.CopyToClipboard title="Copy Account Name" content={data.accountName} />
          </ActionPanel>
        )
      }
    />
  );
}

function ConnectView() {
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const { filter } = prefs();
    return (await getWireGuardUsers()).filter((u) => filter.test(u.name)).sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search user (WireGuard name)…">
      {data?.map((user) => (
        <List.Item
          key={user.id}
          icon={{
            source: Icon.Monitor,
            tintColor: user.online ? Color.Green : user.online === false ? Color.Red : undefined,
          }}
          title={user.name}
          subtitle={user.ip}
          keywords={[user.name.replace(/^.-/, ""), user.ip]}
          accessories={[
            ...(user.online === true
              ? [{ tag: { value: "online", color: Color.Green } }]
              : user.online === false
                ? [{ tag: { value: "offline", color: Color.Red }, tooltip: "Not connected via WireGuard" }]
                : []),
            { text: deviceName(user), tooltip: "Windows device with LAPS" },
          ]}
          actions={
            <ActionPanel>
              <ActionPanel.Section title={deviceName(user)}>
                <Action title="SSH with LAPS" icon={Icon.Terminal} onAction={() => sshWithLaps(user)} />
                <Action
                  title="RDP with LAPS"
                  icon={Icon.Desktop}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
                  onAction={() => rdpWithLaps(user)}
                />
                <Action
                  title="SSH with Own Login"
                  icon={Icon.Person}
                  shortcut={Keyboard.Shortcut.Common.Open}
                  onAction={() => sshOwnLogin(user)}
                />
                <Action.Push
                  title="SSH as Other User…"
                  icon={Icon.PersonLines}
                  shortcut={Keyboard.Shortcut.Common.OpenWith}
                  target={<SshAsUserForm user={user} />}
                />
                <Action.Push
                  title="Show LAPS Password"
                  icon={Icon.Eye}
                  shortcut={{
                    macOS: { modifiers: ["cmd", "shift"], key: "p" },
                    Windows: { modifiers: ["ctrl", "shift"], key: "p" },
                  }}
                  target={<PasswordDetail user={user} />}
                />
              </ActionPanel.Section>
              <ActionPanel.Section>
                <Action.CopyToClipboard title="Copy IP" content={user.ip} shortcut={Keyboard.Shortcut.Common.Copy} />
                <Action.CopyToClipboard
                  title="Copy Device Name"
                  content={deviceName(user)}
                  shortcut={Keyboard.Shortcut.Common.CopyName}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{
                    macOS: { modifiers: ["cmd", "shift"], key: "r" },
                    Windows: { modifiers: ["ctrl", "shift"], key: "r" },
                  }}
                  onAction={revalidate}
                />
                <Action
                  title="Sign out of Microsoft"
                  icon={Icon.Logout}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    await signOut();
                    await showToast({ style: Toast.Style.Success, title: "Signed out" });
                  }}
                />
              </ActionPanel.Section>
              <ActionPanel.Section title="Security">
                <Action
                  title="Lock LAPS Connect"
                  icon={Icon.Lock}
                  shortcut={{ macOS: { modifiers: ["cmd"], key: "l" }, Windows: { modifiers: ["ctrl"], key: "l" } }}
                  onAction={async () => {
                    await lock();
                    await showHUD("🔒 LAPS Connect locked");
                  }}
                />
                <Action.Push title="Change Password" icon={Icon.Key} target={<ChangePasswordForm />} />
                <Action.Push title="Replace UniFi API Key" icon={Icon.Key} target={<ReplaceUnifiKeyForm />} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
      {error && !isLoading ? (
        <List.EmptyView
          icon={{ source: Icon.Warning, tintColor: Color.Red }}
          title="Could not load WireGuard users"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView title="No WireGuard users found" icon={Icon.Monitor} />
      )}
    </List>
  );
}

export default function Connect() {
  return (
    <Gate>
      <ConnectView />
    </Gate>
  );
}
