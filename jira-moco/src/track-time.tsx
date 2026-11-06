import {
  Action,
  ActionPanel,
  Alert,
  LaunchProps,
  Color,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, usePromise } from "@raycast/utils";
import { ReactNode, useEffect, useState } from "react";
import { BookForm } from "./book-form";
import { Bookings } from "./bookings";
import { Config, isComplete, issueUrl, shortcut } from "./lib/config";
import { useConfig, useProjects } from "./lib/hooks";
import { Issue, ISSUE_KEY, searchIssues } from "./lib/jira";
import { readJob, readOrder } from "./lib/match";
import { clock, durationText, parseDuration } from "./lib/time";
import {
  assignIssue,
  elapsedMs,
  isRunning,
  loadTimers,
  pauseAll,
  pauseTimer,
  removeTimer,
  resumeTimer,
  setElapsed,
  setNote,
  sortTimers,
  startFreeTimer,
  startTimer,
  Timer,
  timerLabel,
  updateFreeTimer,
} from "./lib/timers";
import { ensureTray, hideTray, isTrayHidden, showTray, traySupported } from "./lib/tray";
import { Setup } from "./setup";

export default function Command(props: LaunchProps<{ launchContext: { bookTimerId?: string } }>) {
  const { data: config, isLoading, revalidate } = useConfig();
  if (isLoading || !config) return <List isLoading />;
  if (!isComplete(config)) return <Setup onDone={revalidate} />;
  const bookTimerId = props.launchContext?.bookTimerId;
  if (bookTimerId) return <BookTimerById config={config} id={bookTimerId} onConfigChanged={revalidate} />;
  return <TrackTime config={config} onConfigChanged={revalidate} />;
}

/** "Book …" in the tray menu opens the booking form of that timer directly. */
function BookTimerById({ config, id, onConfigChanged }: { config: Config; id: string; onConfigChanged: () => void }) {
  const { data: timers, isLoading } = usePromise(loadTimers);
  if (isLoading || !timers) return <List isLoading />;
  const timer = timers.find((t) => t.id === id);
  if (!timer) return <TrackTime config={config} onConfigChanged={onConfigChanged} />;
  return <BookForm config={config} timer={timer} closeWhenDone />;
}

function safe(fn: () => string | undefined): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function jobAccessories(issue: Issue): List.Item.Accessory[] {
  const job = safe(() => readJob(issue));
  const order = safe(() => readOrder(issue));
  return [
    ...(job ? [{ tag: { value: job, color: Color.Blue }, tooltip: `Job: ${issue.job}` }] : []),
    ...(order ? [{ text: order, tooltip: `Order: ${issue.order}` }] : []),
  ];
}

function timerAccessories(timer: Timer): List.Item.Accessory[] {
  if (timer.issue) return jobAccessories(timer.issue);
  if (!timer.project) return [{ text: { value: "No issue", color: Color.SecondaryText } }];
  return [
    { tag: { value: timer.project.identifier, color: Color.Blue }, tooltip: `MOCO: ${timer.project.name}` },
    ...(timer.task ? [{ text: timer.task.name }] : []),
  ];
}

function TrackTime({ config, onConfigChanged }: { config: Config; onConfigChanged: () => void }) {
  const [searchText, setSearchText] = useState("");
  const { data: stored, isLoading: timersLoading } = usePromise(loadTimers);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (stored) setTimers(stored);
  }, [stored]);

  const anyRunning = timers.some(isRunning);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const reload = async () => setTimers(await loadTimers());

  // The tray icon changes the same timers: pick up its changes while the list is open
  useEffect(() => {
    let last = "";
    const id = setInterval(async () => {
      const fresh = await loadTimers().catch(() => undefined);
      const text = JSON.stringify(fresh);
      if (fresh && text !== last) {
        if (last) setTimers(fresh);
        last = text;
      }
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const tray = usePromise(async () => ({ supported: traySupported(), hidden: isTrayHidden() }));
  useEffect(() => {
    ensureTray().catch(() => undefined);
  }, []);

  const {
    data: issues = [],
    isLoading: issuesLoading,
    revalidate: reloadIssues,
  } = useCachedPromise((q: string) => searchIssues(config, q), [searchText], {
    keepPreviousData: true,
    onError: (error) => void showFailureToast(error, { title: "Jira search failed" }),
  });

  const run = async (action: () => Promise<Timer[]>, title: string) => {
    try {
      setTimers(await action());
      await showToast({ style: Toast.Style.Success, title });
    } catch (error) {
      await showFailureToast(error, { title: "Timer not changed" });
    }
  };

  const text = searchText.trim();
  const q = text.toLowerCase();
  const visibleTimers = sortTimers(timers).filter(
    (t) =>
      !q ||
      [timerLabel(t), t.issue?.summary, t.note, t.project?.identifier, t.project?.name].some((v) =>
        v?.toLowerCase().includes(q),
      ),
  );
  const timerKeys = new Set(timers.flatMap((t) => (t.issue ? [t.issue.key] : [])));

  const pauseAllAction = anyRunning ? (
    <Action
      title="Pause All Timers"
      icon={Icon.Stop}
      shortcut={shortcut("p", ["shift"])}
      onAction={() => run(pauseAll, "All timers paused")}
    />
  ) : null;

  const newFreeTimer = (
    <Action.Push
      title="New Timer Without Issue"
      icon={Icon.PlusCircle}
      shortcut={shortcut("n")}
      target={<FreeTimerForm config={config} initialTitle={ISSUE_KEY.test(text) ? "" : text} onSaved={setTimers} />}
    />
  );

  const common = (
    <ActionPanel.Section>
      <Action.Push
        title="Booked Time"
        icon={Icon.List}
        target={<Bookings config={config} />}
        shortcut={shortcut("h", ["shift"])}
      />
      <Action.Push title="Set up Jira and MOCO" icon={Icon.Gear} target={<Setup onDone={onConfigChanged} />} />
      {tray.data?.supported ? (
        tray.data.hidden ? (
          <Action
            title="Show Tray Icon"
            icon={Icon.Eye}
            onAction={async () => {
              await showTray().catch((error) => showFailureToast(error, { title: "Tray icon not started" }));
              tray.revalidate();
            }}
          />
        ) : (
          <Action
            title="Hide Tray Icon"
            icon={Icon.EyeDisabled}
            onAction={async () => {
              await hideTray();
              tray.revalidate();
              await showToast({ style: Toast.Style.Success, title: "Tray icon hidden" });
            }}
          />
        )
      ) : null}
      <Action
        title="Refresh"
        icon={Icon.RotateClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={() => {
          reload();
          reloadIssues();
        }}
      />
    </ActionPanel.Section>
  );

  return (
    <List
      isLoading={timersLoading || issuesLoading}
      searchBarPlaceholder="Search Jira issues, or type what you work on"
      onSearchTextChange={setSearchText}
      throttle
    >
      <List.Section title="Timers" subtitle={timers.length ? `${timers.length}` : undefined}>
        {visibleTimers.map((timer) => (
          <TimerItem
            key={timer.id}
            config={config}
            timer={timer}
            now={now}
            run={run}
            setTimers={setTimers}
            reload={reload}
            extra={pauseAllAction}
            common={common}
          />
        ))}
      </List.Section>
      <List.Section title={q ? "Issues" : "Recently Viewed in Jira"}>
        {issues
          .filter((issue) => !timerKeys.has(issue.key) || !q)
          .map((issue) => {
            const hasTimer = timerKeys.has(issue.key);
            return (
              <List.Item
                key={issue.key}
                id={`issue-${issue.key}`}
                icon={issue.issueTypeIcon ? { source: issue.issueTypeIcon } : Icon.Document}
                title={issue.key}
                subtitle={issue.summary}
                keywords={[issue.summary]}
                accessories={[
                  ...jobAccessories(issue),
                  ...(hasTimer ? [{ icon: Icon.Clock, tooltip: "Has a timer" }] : []),
                  ...(issue.status
                    ? [
                        {
                          tag: {
                            value: issue.status,
                            color: issue.statusCategory === "done" ? Color.Green : Color.SecondaryText,
                          },
                        },
                      ]
                    : []),
                ]}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title={issue.key}>
                      <Action
                        title={hasTimer ? "Resume Timer" : "Start Timer"}
                        icon={Icon.Play}
                        onAction={() => run(() => startTimer(issue), `Timer running: ${issue.key}`)}
                      />
                      <Action.Push
                        title="Log Time Manually"
                        icon={Icon.PlusCircle}
                        shortcut={shortcut("l")}
                        target={<BookForm config={config} issue={issue} />}
                      />
                      {pauseAllAction}
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      <Action.OpenInBrowser
                        title="Open in Jira"
                        url={issueUrl(config, issue.key)}
                        shortcut={Keyboard.Shortcut.Common.Open}
                      />
                      <Action.CopyToClipboard
                        title="Copy Issue Key"
                        content={issue.key}
                        shortcut={Keyboard.Shortcut.Common.Copy}
                      />
                      {newFreeTimer}
                    </ActionPanel.Section>
                    {common}
                  </ActionPanel>
                }
              />
            );
          })}
      </List.Section>
      <List.Section title="Without Jira Issue">
        {text && !ISSUE_KEY.test(text) ? (
          <List.Item
            id="free-quick"
            icon={{ source: Icon.Play, tintColor: Color.SecondaryText }}
            title={`Start Timer “${text}”`}
            subtitle="without Jira issue, booked to MOCO only"
            actions={
              <ActionPanel>
                <Action
                  title="Start Timer"
                  icon={Icon.Play}
                  onAction={() => run(() => startFreeTimer({ title: text }), `Timer running: ${text}`)}
                />
                <Action.Push
                  title="Start with MOCO Project"
                  icon={Icon.PlusCircle}
                  shortcut={shortcut("n")}
                  target={<FreeTimerForm config={config} initialTitle={text} onSaved={setTimers} />}
                />
                <Action.Push
                  title="Log Time Without Issue"
                  icon={Icon.Clock}
                  shortcut={shortcut("l")}
                  target={<BookForm config={config} />}
                />
                {common}
              </ActionPanel>
            }
          />
        ) : (
          <List.Item
            id="free-new"
            icon={{ source: Icon.PlusCircle, tintColor: Color.SecondaryText }}
            title="New Timer Without Jira Issue"
            subtitle="e.g. meetings or internal work, booked to MOCO only"
            actions={
              <ActionPanel>
                {newFreeTimer}
                <Action.Push
                  title="Log Time Without Issue"
                  icon={Icon.Clock}
                  shortcut={shortcut("l")}
                  target={<BookForm config={config} />}
                />
                {common}
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}

interface TimerItemProps {
  config: Config;
  timer: Timer;
  now: number;
  run: (action: () => Promise<Timer[]>, title: string) => Promise<void>;
  setTimers: (timers: Timer[]) => void;
  reload: () => void;
  extra: ReactNode;
  common: ReactNode;
}

function TimerItem({ config, timer, now, run, setTimers, reload, extra, common }: TimerItemProps) {
  const running = isRunning(timer);
  const label = timerLabel(timer);
  const issue = timer.issue;
  return (
    <List.Item
      id={`timer-${timer.id}`}
      icon={
        running
          ? { source: Icon.Play, tintColor: Color.Green, tooltip: "Running" }
          : { source: Icon.Pause, tintColor: Color.Orange, tooltip: "Paused" }
      }
      title={label}
      subtitle={timer.note || issue?.summary}
      keywords={[issue?.summary ?? "", timer.project?.identifier ?? "", timer.project?.name ?? ""]}
      accessories={[
        ...timerAccessories(timer),
        { text: { value: clock(elapsedMs(timer, now)), color: running ? Color.Green : Color.SecondaryText } },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section title={label}>
            {running ? (
              <Action
                title="Pause Timer"
                icon={Icon.Pause}
                onAction={() => run(() => pauseTimer(timer.id), `Paused ${label}`)}
              />
            ) : (
              <Action
                title="Resume Timer"
                icon={Icon.Play}
                onAction={() => run(() => resumeTimer(timer.id), `Resumed ${label}`)}
              />
            )}
            <Action.Push
              title="Book and Stop Timer"
              icon={Icon.Upload}
              shortcut={shortcut("b")}
              target={<BookForm config={config} timer={timer} onBooked={reload} />}
            />
            {issue ? (
              <Action.Push
                title="Edit Note"
                icon={Icon.Pencil}
                shortcut={shortcut("e")}
                target={<NoteForm timer={timer} onSaved={setTimers} />}
              />
            ) : (
              <Action.Push
                title="Edit Timer"
                icon={Icon.Pencil}
                shortcut={shortcut("e")}
                target={<FreeTimerForm config={config} timer={timer} onSaved={setTimers} />}
              />
            )}
            {issue ? null : (
              <Action.Push
                title="Assign Jira Issue"
                icon={Icon.Link}
                shortcut={shortcut("j")}
                target={<IssuePicker config={config} timer={timer} onSaved={setTimers} />}
              />
            )}
            <Action.Push
              title="Correct Time"
              icon={Icon.Clock}
              shortcut={shortcut("t")}
              target={<TimeForm timer={timer} onSaved={setTimers} />}
            />
            {extra}
          </ActionPanel.Section>
          <ActionPanel.Section>
            {issue ? (
              <>
                <Action.OpenInBrowser
                  title="Open in Jira"
                  url={issueUrl(config, issue.key)}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action.CopyToClipboard
                  title="Copy Issue Key"
                  content={issue.key}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              </>
            ) : null}
            <Action
              title="Discard Timer"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={Keyboard.Shortcut.Common.Remove}
              onAction={async () => {
                const ok = await confirmAlert({
                  title: `Discard the timer “${label}”?`,
                  message: `${clock(elapsedMs(timer))} will not be booked.`,
                  primaryAction: { title: "Discard", style: Alert.ActionStyle.Destructive },
                });
                if (ok) await run(() => removeTimer(timer.id), "Timer discarded");
              }}
            />
          </ActionPanel.Section>
          {common}
        </ActionPanel>
      }
    />
  );
}

/** Starts (or edits) a timer without Jira issue, optionally with its MOCO project and task. */
function FreeTimerForm({
  config,
  timer,
  initialTitle = "",
  onSaved,
}: {
  config: Config;
  timer?: Timer;
  initialTitle?: string;
  onSaved: (timers: Timer[]) => void;
}) {
  const { pop } = useNavigation();
  const { data: projects = [], isLoading } = useProjects(config);
  const [title, setTitle] = useState(timer?.title ?? initialTitle);
  const [titleError, setTitleError] = useState<string>();
  const [projectId, setProjectId] = useState(timer?.project ? String(timer.project.id) : "");
  const [taskId, setTaskId] = useState(timer?.task ? String(timer.task.id) : "");
  const project = projects.find((p) => String(p.id) === projectId);

  const submit = async (values: { note: string }) => {
    if (!title.trim()) {
      setTitleError("What are you working on?");
      return;
    }
    const task = project?.tasks.find((t) => String(t.id) === taskId);
    const input = {
      title,
      note: values.note,
      project: project ? { id: project.id, identifier: project.identifier, name: project.name } : undefined,
      task: task ? { id: task.id, name: task.name } : undefined,
    };
    try {
      onSaved(timer ? await updateFreeTimer(timer.id, input) : await startFreeTimer(input));
      await showToast({ style: Toast.Style.Success, title: timer ? "Timer saved" : `Timer running: ${title.trim()}` });
      pop();
    } catch (error) {
      await showFailureToast(error, { title: "Timer not saved" });
    }
  };

  return (
    <Form
      navigationTitle={timer ? `Edit Timer · ${timerLabel(timer)}` : "New Timer Without Issue"}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={timer ? "Save Timer" : "Start Timer"} icon={Icon.Play} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Working On"
        placeholder="e.g. Team meeting, offer for customer X"
        value={title}
        error={titleError}
        onChange={(v) => {
          setTitle(v);
          setTitleError(undefined);
        }}
      />
      <Form.TextArea
        id="note"
        title="Note"
        placeholder="Optional, becomes the booking description"
        defaultValue={timer?.note}
      />
      <Form.Separator />
      <Form.Description text="Optional: choose the MOCO project now, or when booking. A Jira issue can be assigned later (Ctrl/Cmd+J)." />
      <Form.Dropdown
        id="project"
        title="MOCO Project"
        value={projectId}
        onChange={(v) => {
          setProjectId(v);
          const next = projects.find((p) => String(p.id) === v);
          setTaskId(next?.tasks.length === 1 ? String(next.tasks[0].id) : "");
        }}
      >
        <Form.Dropdown.Item value="" title="Choose when booking" />
        {projects.map((p) => (
          <Form.Dropdown.Item
            key={p.id}
            value={String(p.id)}
            title={`${p.identifier} · ${p.name}`}
            keywords={[p.identifier, p.name, p.customer?.name ?? ""]}
          />
        ))}
      </Form.Dropdown>
      {project ? (
        <Form.Dropdown id="task" title="MOCO Task" value={taskId} onChange={setTaskId}>
          <Form.Dropdown.Item value="" title="Choose when booking" />
          {project.tasks.map((t) => (
            <Form.Dropdown.Item key={t.id} value={String(t.id)} title={t.name} />
          ))}
        </Form.Dropdown>
      ) : null}
    </Form>
  );
}

/** Search a Jira issue and attach it to a timer without issue. */
function IssuePicker({ config, timer, onSaved }: { config: Config; timer: Timer; onSaved: (timers: Timer[]) => void }) {
  const { pop } = useNavigation();
  const [searchText, setSearchText] = useState("");
  const { data: issues = [], isLoading } = useCachedPromise((q: string) => searchIssues(config, q), [searchText], {
    keepPreviousData: true,
    onError: (error) => void showFailureToast(error, { title: "Jira search failed" }),
  });
  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Assign Issue · ${timerLabel(timer)}`}
      searchBarPlaceholder="Search Jira issues by key or text"
      onSearchTextChange={setSearchText}
      throttle
    >
      {issues.map((issue) => (
        <List.Item
          key={issue.key}
          icon={issue.issueTypeIcon ? { source: issue.issueTypeIcon } : Icon.Document}
          title={issue.key}
          subtitle={issue.summary}
          accessories={jobAccessories(issue)}
          actions={
            <ActionPanel>
              <Action
                title="Assign to Timer"
                icon={Icon.Link}
                onAction={async () => {
                  try {
                    onSaved(await assignIssue(timer.id, issue));
                    await showToast({ style: Toast.Style.Success, title: `Timer now on ${issue.key}` });
                    pop();
                  } catch (error) {
                    await showFailureToast(error, { title: "Issue not assigned" });
                  }
                }}
              />
              <Action.OpenInBrowser title="Open in Jira" url={issueUrl(config, issue.key)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function NoteForm({ timer, onSaved }: { timer: Timer; onSaved: (timers: Timer[]) => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Note · ${timerLabel(timer)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Note"
            icon={Icon.Check}
            onSubmit={async (values: { note: string }) => {
              onSaved(await setNote(timer.id, values.note.trim()));
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title={timerLabel(timer)} text={timer.issue?.summary ?? ""} />
      <Form.TextArea
        id="note"
        title="Note"
        placeholder="What are you working on? Becomes the booking description"
        defaultValue={timer.note}
      />
    </Form>
  );
}

function TimeForm({ timer, onSaved }: { timer: Timer; onSaved: (timers: Timer[]) => void }) {
  const { pop } = useNavigation();
  const [error, setError] = useState<string>();
  return (
    <Form
      navigationTitle={`Correct Time · ${timerLabel(timer)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Set Time"
            icon={Icon.Check}
            onSubmit={async (values: { duration: string }) => {
              const seconds = parseDuration(values.duration);
              if (seconds === undefined) {
                setError("e.g. 1:30, 1h 30m, 1.5 or 90");
                return;
              }
              onSaved(await setElapsed(timer.id, seconds * 1000));
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title={timerLabel(timer)} text={`The timer currently shows ${clock(elapsedMs(timer))}.`} />
      <Form.TextField
        id="duration"
        title="Time Spent"
        placeholder="1:30, 1h 30m, 1.5 or 90"
        defaultValue={durationText(elapsedMs(timer) / 1000)}
        error={error}
        onChange={() => setError(undefined)}
        info="Forgot to start or stop the timer? Set the time you actually worked; the timer keeps running from there."
      />
    </Form>
  );
}
