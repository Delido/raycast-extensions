import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  getPreferenceValues,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { book } from "./lib/booking";
import { Config } from "./lib/config";
import { useProjects } from "./lib/hooks";
import { getIssue, Issue } from "./lib/jira";
import { findTask, Match, matchIssue, rememberChoice } from "./lib/match";
import { clock, durationText, hours, parseDuration, roundUp } from "./lib/time";
import { elapsedMs, removeTimer, startedAt, Timer, timerLabel } from "./lib/timers";

interface Props {
  config: Config;
  /** Without issue (and without the timer's issue) the time goes to MOCO only */
  issue?: Issue;
  /** Book this timer; without it the form is a manual entry */
  timer?: Timer;
  onBooked?: () => void;
  /** Opened directly (from the tray menu): close Raycast after booking instead of going back */
  closeWhenDone?: boolean;
}

export function BookForm({ config, issue: issueProp, timer, onBooked, closeWhenDone }: Props) {
  const initialIssue = timer?.issue ?? issueProp;
  const label = timer ? timerLabel(timer) : (initialIssue?.key ?? "Without Issue");
  const { pop } = useNavigation();
  const rounding = Number(getPreferenceValues<Preferences>().rounding || 1);
  const timerMs = useMemo(() => (timer ? elapsedMs(timer) : 0), [timer]);

  // Read the issue again: job and order may have changed since the timer started
  const { data: freshIssue } = usePromise((key: string) => getIssue(config, key), [initialIssue?.key ?? ""], {
    execute: !!initialIssue,
    onError: () => undefined,
  });
  const issue = freshIssue ?? initialIssue;
  const { data: projects = [], isLoading: projectsLoading, error: projectsError } = useProjects(config);

  const [description, setDescription] = useState(timer?.note || (timer && !timer.issue ? (timer.title ?? "") : ""));
  const [duration, setDuration] = useState(timer ? durationText(roundUp(timerMs / 1000, rounding)) : "");
  const [durationError, setDurationError] = useState<string>();
  const [started, setStarted] = useState<Date | null>(timer ? startedAt(timer) : new Date());
  const [startTouched, setStartTouched] = useState(!!timer);
  const [projectId, setProjectId] = useState(timer?.project ? String(timer.project.id) : "");
  const [taskId, setTaskId] = useState(timer?.task ? String(timer.task.id) : "");
  const [billable, setBillable] = useState(true);
  const [toJira, setToJira] = useState(!!initialIssue);
  const [toMoco, setToMoco] = useState(true);
  const [match, setMatch] = useState<Match>();
  const [choiceTouched, setChoiceTouched] = useState(false);

  useEffect(() => {
    if (!projects.length) return;
    if (!issue) {
      // Timer without issue: project and task were chosen when it was started
      const p = projects.find((x) => String(x.id) === projectId);
      const t = p?.tasks.find((x) => String(x.id) === taskId);
      if (p && t && !choiceTouched) setBillable(p.billable && t.billable);
      return;
    }
    let cancelled = false;
    matchIssue(issue, projects)
      .then((m) => {
        if (cancelled) return;
        setMatch(m);
        if (choiceTouched) return;
        setProjectId(m.project ? String(m.project.id) : "");
        setTaskId(m.task ? String(m.task.id) : "");
        if (m.project && m.task) setBillable(m.project.billable && m.task.billable);
      })
      .catch((error) => showToast({ style: Toast.Style.Failure, title: "Can't read the job", message: String(error) }));
    return () => {
      cancelled = true;
    };
  }, [projects, issue?.job, issue?.order]);

  const project = projects.find((p) => String(p.id) === projectId);
  const task = project?.tasks.find((t) => String(t.id) === taskId);

  const changeProject = (value: string) => {
    setChoiceTouched(true);
    setProjectId(value);
    const next = projects.find((p) => String(p.id) === value);
    const guess = findTask(next, match?.order);
    setTaskId(guess ? String(guess.id) : "");
    if (next && guess) setBillable(next.billable && guess.billable);
  };

  const changeTask = (value: string) => {
    setChoiceTouched(true);
    setTaskId(value);
    const t = project?.tasks.find((x) => String(x.id) === value);
    if (project && t) setBillable(project.billable && t.billable);
  };

  const submit = async () => {
    const seconds = parseDuration(duration);
    if (!seconds) {
      setDurationError("e.g. 1:30, 1h 30m, 1.5 or 90");
      return;
    }
    if (!(toJira && issue) && !toMoco) {
      await showToast({ style: Toast.Style.Failure, title: "Choose Jira, MOCO or both" });
      return;
    }
    if (toMoco && (!project || !task)) {
      await showToast({ style: Toast.Style.Failure, title: "Choose the MOCO project and task" });
      return;
    }
    // Manual entry without a chosen start: the work ended just now
    const start = startTouched && started ? started : new Date(Date.now() - seconds * 1000);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Booking ${hours(seconds)} on ${label}…` });
    const result = await book(config, {
      issue,
      title: timer?.title || description.trim().split(/\r?\n/)[0] || undefined,
      started: start,
      seconds,
      description: description.trim(),
      toJira: toJira && !!issue,
      toMoco,
      project: project ? { id: project.id, identifier: project.identifier, name: project.name } : undefined,
      task: task ? { id: task.id, name: task.name } : undefined,
      billable,
    });
    const ok = [result.jira, result.moco].filter((t) => t.state === "done").length;
    const failed = [
      result.jira.state === "failed" ? `Jira: ${result.jira.error}` : "",
      result.moco.state === "failed" ? `MOCO: ${result.moco.error}` : "",
    ].filter(Boolean);

    if (!ok) {
      toast.style = Toast.Style.Failure;
      toast.title = "Nothing was booked";
      toast.message = failed.join("\n");
      return;
    }
    if (issue && project && task) await rememberChoice(issue, projects, project.id, task.id).catch(() => undefined);
    if (timer) await removeTimer(timer.id);
    if (failed.length) {
      toast.style = Toast.Style.Failure;
      toast.title = `${failed[0].split(":")[0]} failed, retry it in Booked Time`;
      toast.message = failed.join("\n");
    } else {
      toast.style = Toast.Style.Success;
      toast.title = `Booked ${hours(seconds)} on ${label}`;
      toast.message = [toJira && issue ? "Jira" : "", toMoco ? "MOCO" : ""].filter(Boolean).join(" + ");
    }
    onBooked?.();
    if (closeWhenDone) await closeMainWindow({ clearRootSearch: true });
    else pop();
  };

  const jobInfo = (() => {
    if (!issue) return "No Jira issue: the time goes to MOCO only. Choose project and task.";
    if (!config.jobField) return "No job field chosen (Set Up)";
    if (!match) return projectsLoading ? "Loading MOCO projects…" : "";
    const job = match.job ? `${config.jobField.name}: ${match.job}` : `${config.jobField.name} is empty`;
    const order = config.orderField
      ? match.order
        ? `${config.orderField.name}: ${match.order}`
        : `${config.orderField.name} is empty`
      : "";
    const result = match.remembered
      ? "→ project and task you chose last time"
      : match.project
        ? match.task
          ? "→ found in MOCO"
          : "→ project found, choose the task"
        : match.job
          ? "→ not among your MOCO projects, choose one"
          : "→ choose project and task";
    return [job, order, result].filter(Boolean).join("\n");
  })();

  return (
    <Form
      navigationTitle={`Book Time · ${label}`}
      isLoading={projectsLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={timer ? "Book and Stop Timer" : "Book Time"} icon={Icon.Upload} onSubmit={submit} />
        </ActionPanel>
      }
    >
      {issue ? (
        <Form.Description title={issue.key} text={issue.summary} />
      ) : (
        <Form.Description
          title={label}
          text="No Jira issue. To log it in Jira too, assign an issue to the timer first (Ctrl/Cmd+J in Track Time)."
        />
      )}
      <Form.TextField
        id="duration"
        title="Duration"
        placeholder="1:30, 1h 30m, 1.5 or 90"
        value={duration}
        error={durationError}
        info={
          timer ? `Timer shows ${clock(timerMs)}${rounding > 1 ? `, rounded up to ${rounding} min` : ""}` : undefined
        }
        onChange={(v) => {
          setDuration(v);
          setDurationError(undefined);
        }}
      />
      <Form.TextArea
        id="description"
        title="Description"
        placeholder="What did you do? Goes to the Jira worklog and the MOCO activity"
        value={description}
        onChange={setDescription}
      />
      <Form.DatePicker
        id="started"
        title="Started"
        type={Form.DatePicker.Type.DateTime}
        value={started}
        info={timer ? "Start of the timer" : "Leave it to book the time as ending now"}
        onChange={(v) => {
          setStarted(v);
          setStartTouched(true);
        }}
      />
      <Form.Separator />
      <Form.Description title="Job" text={projectsError ? `MOCO: ${projectsError.message}` : jobInfo} />
      <Form.Dropdown id="project" title="MOCO Project" value={projectId} onChange={changeProject}>
        <Form.Dropdown.Item value="" title="Choose a project…" />
        {projects.map((p) => (
          <Form.Dropdown.Item
            key={p.id}
            value={String(p.id)}
            title={`${p.identifier} · ${p.name}`}
            keywords={[p.identifier, p.name, p.customer?.name ?? ""]}
          />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="task" title="MOCO Task" value={taskId} onChange={changeTask}>
        <Form.Dropdown.Item value="" title={project ? "Choose a task…" : "Choose the project first"} />
        {(project?.tasks ?? []).map((t) => (
          <Form.Dropdown.Item key={t.id} value={String(t.id)} title={t.name} />
        ))}
      </Form.Dropdown>
      <Form.Checkbox id="billable" label="Billable" value={billable} onChange={setBillable} />
      <Form.Separator />
      {issue ? (
        <>
          <Form.Checkbox id="toJira" title="Book To" label="Jira worklog" value={toJira} onChange={setToJira} />
          <Form.Checkbox id="toMoco" label="MOCO activity" value={toMoco} onChange={setToMoco} />
        </>
      ) : null}
    </Form>
  );
}
