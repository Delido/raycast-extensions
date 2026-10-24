import { Action, ActionPanel, closeMainWindow, Color, Icon, List, showHUD, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useState } from "react";
import { getServiceStatus, pressTeamSpeakKey, TeamSpeakStatus, testTeamSpeakKey } from "./service";

type StepState = "done" | "todo" | "waiting" | "failed";

interface Step {
  id: string;
  title: string;
  state: StepState;
  subtitle?: string;
  markdown: string;
}

const ICONS: Record<StepState, { source: Icon; tintColor: Color }> = {
  done: { source: Icon.CheckCircle, tintColor: Color.Green },
  todo: { source: Icon.Circle, tintColor: Color.SecondaryText },
  waiting: { source: Icon.Clock, tintColor: Color.Orange },
  failed: { source: Icon.XMarkCircle, tintColor: Color.Red },
};

export function isTeamSpeakReady(ts?: TeamSpeakStatus): boolean {
  return !!ts && ts.state === "connected" && ts.keyBound === true;
}

function steps(ts: TeamSpeakStatus | undefined): Step[] {
  const running = !!ts && ts.state !== "offline";
  const approved = ts?.state === "connected";
  const onServer = approved && (ts?.servers ?? 0) > 0;
  const bound = ts?.keyBound === true;
  return [
    {
      id: "running",
      title: "TeamSpeak is running",
      state: running ? "done" : "todo",
      subtitle: running ? undefined : ts?.lastError,
      markdown: `## 1. Start TeamSpeak

Start **TeamSpeak 5 or 6**. The companion connects to it automatically through TeamSpeak's *Remote Apps* interface.

If this step stays open while TeamSpeak runs: **TeamSpeak → Settings → Remote Apps** must be enabled (it is by default).`,
    },
    {
      id: "approve",
      title: "Allow the companion in TeamSpeak",
      state: approved ? "done" : running ? "waiting" : "todo",
      subtitle: running && !approved ? "TeamSpeak is asking you right now" : undefined,
      markdown: `## 2. Allow the companion

TeamSpeak asks once whether **"SignalRGB Companion (Raycast)"** may connect. Click **Allow**.

Don't see the question? Bring the TeamSpeak window to the front, or look under **Settings → Remote Apps**, where pending apps are listed.

The approval is stored, you won't be asked again.`,
    },
    {
      id: "server",
      title: "Connect to a TeamSpeak server",
      state: onServer ? "done" : approved ? "waiting" : "todo",
      markdown: `## 3. Connect to a server

Join any TeamSpeak server. The companion needs a connection to read your microphone mute state, and to check in the next steps that the key works.`,
    },
    {
      id: "bind",
      title: "Bind the mute key in TeamSpeak",
      state: bound ? "done" : ts?.keyBound === false ? "failed" : onServer ? "todo" : "todo",
      subtitle:
        ts?.keyProblem === "switches-back"
          ? "TeamSpeak switches back on key release: wrong action or bound twice"
          : ts?.keyBound === false
            ? "Last key press didn't mute TeamSpeak"
            : undefined,
      markdown: `## 4. Bind the mute key

TeamSpeak can't be muted directly by other apps. Instead, the companion presses a *virtual key* that you assign to TeamSpeak's mute action once:

1. In TeamSpeak open **Settings → Key Bindings** and add a binding for **Toggle Microphone Mute** (*Mikrofon stummschalten umschalten*). Don't start recording yet.
2. Here in Raycast run **Send Key in 5 Seconds** (Enter). Raycast closes.
3. Within those 5 seconds click **record** in TeamSpeak and keep the TeamSpeak window in front.

TeamSpeak then shows the key as *signalrgb.mic.toggle*. Save the binding, then run step 5.

**Mute switches straight back off?** Then the key is bound to an action that unmutes on release (e.g. *Push-to-Mute*, "while held") or it is bound twice. In **Key Bindings**, delete every binding that uses *signalrgb.mic.toggle* and bind it **once**, only to **Toggle Microphone Mute**. Until the test in step 5 passes, the companion doesn't press the key, so your headset mute always stays as you set it.`,
    },
    {
      id: "test",
      title: "Test",
      state: bound ? "done" : ts?.keyBound === false ? "failed" : "todo",
      subtitle: bound ? "Headset mute now mutes TeamSpeak" : undefined,
      markdown: `## 5. Test

**Test Mute Key** (Enter) presses the key once, checks that TeamSpeak's microphone mute changed, and switches it back.

When this step is green you're done: the headset mute button now also mutes TeamSpeak, and muting in TeamSpeak mutes the headset and Windows.`,
    },
  ];
}

export function TeamSpeakSetup() {
  const [ts, setTs] = useState<TeamSpeakStatus>();
  const [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    setTs((await getServiceStatus())?.teamspeak);
    setLoaded(true);
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, []);

  const sendKey = async () => {
    try {
      await pressTeamSpeakKey(5);
      await closeMainWindow();
      await showHUD("Click “record” in TeamSpeak now, the key comes in 5 seconds");
    } catch (error) {
      await showFailureToast(error, { title: "TeamSpeak not ready" });
    }
  };

  const test = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Testing mute key…" });
    try {
      await testTeamSpeakKey();
      // The companion reports the result within ~2 s (keyBound).
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const now = (await getServiceStatus())?.teamspeak;
        if (now?.keyBound === true) {
          await new Promise((r) => setTimeout(r, 600));
          await testTeamSpeakKey().catch(() => undefined); // switch back
          toast.style = Toast.Style.Success;
          toast.title = "Works: TeamSpeak follows the headset mute";
          return refresh();
        }
        if (now?.keyBound === false) break;
      }
      toast.style = Toast.Style.Failure;
      toast.title = "TeamSpeak didn't react";
      toast.message = "Bind the key to “Toggle Microphone Mute” (step 4)";
      refresh();
    } catch (error) {
      toast.hide();
      await showFailureToast(error, { title: "Test failed" });
    }
  };

  const list = steps(ts);
  return (
    <List isLoading={!loaded} isShowingDetail navigationTitle="Configure TeamSpeak Mute">
      {!loaded ? null : !ts ? (
        <List.EmptyView
          icon={Icon.Plug}
          title="Companion service is not running"
          description="Start it in Headset & Companion first"
        />
      ) : null}
      {ts && !ts.enabled ? (
        <List.EmptyView
          icon={Icon.Plug}
          title="TeamSpeak integration is off"
          description="Enable “Headset mute also mutes TeamSpeak” in the Companion Service settings"
        />
      ) : null}
      {ts && ts.enabled
        ? list.map((step) => (
            <List.Item
              key={step.id}
              icon={ICONS[step.state]}
              title={step.title}
              subtitle={step.subtitle}
              detail={<List.Item.Detail markdown={step.markdown} />}
              actions={
                <ActionPanel>
                  {step.id === "bind" ? (
                    <Action title="Send Key in 5 Seconds" icon={Icon.Keyboard} onAction={sendKey} />
                  ) : null}
                  {step.id === "test" || step.id === "bind" ? (
                    <Action title="Test Mute Key" icon={Icon.CheckCircle} onAction={test} />
                  ) : null}
                  <Action title="Refresh" icon={Icon.RotateClockwise} onAction={refresh} />
                </ActionPanel>
              }
            />
          ))
        : null}
    </List>
  );
}
