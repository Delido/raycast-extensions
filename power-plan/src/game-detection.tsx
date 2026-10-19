import { Action, ActionPanel, Color, Icon, List, showToast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { resetAutoState } from "./auto";
import { getStatus, Process } from "./helper";
import {
  Detection,
  detectGames,
  displayName,
  extraLibraries,
  getSettings,
  isExcluded,
  libraryOf,
  Reason,
  updateSettings,
} from "./settings";

const REASON_TAG: Record<Reason, { value: string; color: Color }> = {
  library: { value: "Game library", color: Color.Purple },
  custom: { value: "My list", color: Color.Blue },
  fullscreen: { value: "Fullscreen", color: Color.Orange },
};

async function load() {
  const [status, settings] = await Promise.all([getStatus(), getSettings()]);
  const games = detectGames(status, settings);
  const gameNames = new Set(games.map((g) => g.process.name.toLowerCase()));

  // Running programs outside Windows' own folder, one per exe name
  const apps = new Map<string, Process>();
  for (const process of status.processes) {
    const key = process.name.toLowerCase();
    if (!process.path || /^[a-z]:\\windows\\/i.test(process.path) || gameNames.has(key) || apps.has(key)) continue;
    apps.set(key, process);
  }
  return {
    games,
    settings,
    apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)),
    extra: extraLibraries(),
  };
}

export default function GameDetection() {
  const { data, isLoading, revalidate } = usePromise(load);

  const addGame = async (name: string) => {
    const settings = await getSettings();
    const key = name.toLowerCase();
    await updateSettings({
      customGames: [...new Set([...settings.customGames, key])],
      excluded: settings.excluded.filter((e) => e !== key),
    });
    await resetAutoState();
    await showToast({ title: `${name} counts as a game` });
    revalidate();
  };

  const exclude = async (name: string) => {
    const settings = await getSettings();
    const key = name.toLowerCase();
    await updateSettings({
      excluded: [...new Set([...settings.excluded, key])],
      customGames: settings.customGames.filter((g) => g !== key),
    });
    await resetAutoState();
    await showToast({ title: `${name} is never treated as a game` });
    revalidate();
  };

  const forget = async (name: string) => {
    const settings = await getSettings();
    await updateSettings({
      customGames: settings.customGames.filter((g) => g !== name),
      excluded: settings.excluded.filter((e) => e !== name),
    });
    await resetAutoState();
    revalidate();
  };

  const processItem = (process: Process, detection?: Detection) => {
    const library = libraryOf(process.path, data?.extra ?? []);
    const excluded = data ? isExcluded(process.name, data.settings) : false;
    return (
      <List.Item
        key={`${detection ? "game" : "app"}-${process.name}`}
        icon={detection ? { source: Icon.GameController, tintColor: Color.Purple } : { fileIcon: process.path ?? "" }}
        title={displayName(process)}
        subtitle={process.path}
        accessories={[
          ...(detection ? [{ tag: REASON_TAG[detection.reason], tooltip: detection.detail }] : []),
          ...(!detection && library
            ? [{ tag: { value: "Excluded", color: Color.SecondaryText }, tooltip: "In a game library, but excluded" }]
            : []),
        ]}
        actions={
          <ActionPanel>
            {detection || library ? (
              <Action title="Never Treat as Game" icon={Icon.XMarkCircle} onAction={() => exclude(process.name)} />
            ) : null}
            {!detection || excluded ? (
              <Action title="Treat as Game" icon={Icon.GameController} onAction={() => addGame(process.name)} />
            ) : null}
            {process.path ? <Action.ShowInFinder title="Show in Explorer" path={process.path} /> : null}
            <Action.CopyToClipboard title="Copy Path" content={process.path ?? process.name} />
            <Action title="Refresh" icon={Icon.RotateClockwise} onAction={revalidate} />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter running programs...">
      <List.Section title="Detected Games" subtitle={data ? String(data.games.length) : undefined}>
        {data?.games.length === 0 ? (
          <List.Item
            icon={Icon.Moon}
            title="No game running"
            subtitle="Start a game, or mark a program below as a game"
            actions={
              <ActionPanel>
                <Action title="Refresh" icon={Icon.RotateClockwise} onAction={revalidate} />
              </ActionPanel>
            }
          />
        ) : null}
        {data?.games.map((detection) => processItem(detection.process, detection))}
      </List.Section>
      {data && (data.settings.customGames.length > 0 || data.settings.excluded.length > 0) ? (
        <List.Section title="My Rules">
          {data.settings.customGames.map((name) => (
            <List.Item
              key={`rule-game-${name}`}
              icon={{ source: Icon.GameController, tintColor: Color.Blue }}
              title={name}
              accessories={[{ tag: { value: "Game", color: Color.Blue } }]}
              actions={
                <ActionPanel>
                  <Action title="Remove Rule" icon={Icon.Trash} onAction={() => forget(name)} />
                </ActionPanel>
              }
            />
          ))}
          {data.settings.excluded.map((name) => (
            <List.Item
              key={`rule-excl-${name}`}
              icon={{ source: Icon.XMarkCircle, tintColor: Color.SecondaryText }}
              title={name}
              accessories={[{ tag: { value: "Never a game", color: Color.SecondaryText } }]}
              actions={
                <ActionPanel>
                  <Action title="Remove Rule" icon={Icon.Trash} onAction={() => forget(name)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}
      <List.Section title="Other Running Programs" subtitle={data ? String(data.apps.length) : undefined}>
        {data?.apps.map((process) => processItem(process))}
      </List.Section>
    </List>
  );
}
