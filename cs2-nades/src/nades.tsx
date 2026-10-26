import { Action, ActionPanel, Color, getPreferenceValues, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, usePromise } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import {
  loadMap,
  mapName,
  movementLabel,
  Nade,
  NADE_TYPES,
  OTHER_MAPS,
  precisionLabel,
  PREMIER_MAPS,
  SITE,
  Team,
  techniqueLabel,
  typeTitle,
} from "./csnades";
import { cachedGif, canInstallFfmpeg, fileUrl, findFfmpeg, installFfmpeg, makeGif } from "./video";

type Side = "all" | Team;

type Video =
  | { state: "off" }
  | { state: "no-ffmpeg" }
  | { state: "pending" }
  | { state: "ready"; file: string }
  | { state: "error"; message: string };

const SIDE_TITLE: Record<Side, string> = { all: "T + CT", t: "T Side", ct: "CT Side" };
const NEXT_SIDE: Record<Side, Side> = { all: "t", t: "ct", ct: "all" };

function shortcut(key: Keyboard.KeyEquivalent, shift = false): Keyboard.Shortcut {
  return {
    macOS: { modifiers: shift ? ["cmd", "shift"] : ["cmd"], key },
    Windows: { modifiers: shift ? ["ctrl", "shift"] : ["ctrl"], key },
  };
}

function teamTag(team: Team) {
  return team === "t" ? { value: "T", color: Color.Yellow } : { value: "CT", color: Color.Blue };
}

function videoMarkdown(video: Video): string {
  switch (video.state) {
    case "ready":
      return `![Video](${fileUrl(video.file)})`;
    case "pending":
      return "_Preparing the video …_";
    case "error":
      return `_The video could not be prepared: ${video.message}_`;
    case "no-ffmpeg":
      return canInstallFfmpeg
        ? "**Install ffmpeg to watch the video right here:** Ctrl+Shift+F"
        : "**Install ffmpeg (`brew install ffmpeg`) to watch the video right here**";
    default:
      return "";
  }
}

function NadeDetail({ nade, video }: { nade: Nade; video: Video }) {
  const markdown = [
    videoMarkdown(video),
    nade.lineup ? `![Lineup](${nade.lineup})` : "",
    nade.thumbnail && video.state !== "ready" ? `![Landing spot](${nade.thumbnail})` : "",
    `_Enter plays the HQ video in the browser · Source: [csnades.gg](${nade.url})_`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const tag = teamTag(nade.team);
  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Target" text={nade.to} />
          <List.Item.Detail.Metadata.Label title="Throw From" text={nade.from} />
          <List.Item.Detail.Metadata.TagList title="Side">
            <List.Item.Detail.Metadata.TagList.Item text={tag.value} color={tag.color} />
            {nade.recommended && <List.Item.Detail.Metadata.TagList.Item text="Recommended" color={Color.Green} />}
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Throw" text={techniqueLabel(nade.technique)} />
          <List.Item.Detail.Metadata.Label title="Movement" text={movementLabel(nade.movement)} />
          <List.Item.Detail.Metadata.Label title="Precision" text={precisionLabel(nade.precision)} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Link title="Video" target={nade.videoHq} text="Play HQ video" />
          <List.Item.Detail.Metadata.Link title="Source" target={nade.url} text="csnades.gg" />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function Command() {
  const { onlyRecommended, inlineVideo, ffmpegPath } = getPreferenceValues<Preferences.Nades>();
  const [map, setMap] = useState<string>("");
  const [side, setSide] = useState<Side>("all");
  const [recommended, setRecommended] = useState(onlyRecommended);

  const { data, isLoading, revalidate, error } = useCachedPromise(loadMap, [map], { execute: map !== "" });
  const ffmpeg = usePromise(findFfmpeg, [ffmpegPath], { execute: inlineVideo });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videos, setVideos] = useState<Record<string, Video>>({});

  // Only the selected lineup is converted, after a short pause so scrolling does not start
  // a conversion for every row. Moving on aborts it; finished GIFs are cached on disk.
  useEffect(() => {
    const nade = (Array.isArray(data) ? data : []).find((n) => n.id === selectedId);
    const exe = ffmpeg.data;
    if (!inlineVideo || !nade || !exe) return;
    const set = (video?: Video) =>
      setVideos((all) => {
        const next = { ...all };
        if (video) next[nade.id] = video;
        else delete next[nade.id];
        return next;
      });
    const cached = cachedGif(nade);
    if (cached) {
      set({ state: "ready", file: cached });
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      set({ state: "pending" });
      makeGif(nade, exe, abort.signal).then(
        (file) => set({ state: "ready", file }),
        (err: Error) => set(abort.signal.aborted ? undefined : { state: "error", message: err.message }),
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [selectedId, data, ffmpeg.data, inlineVideo]);

  function videoOf(id: string): Video {
    if (!inlineVideo) return { state: "off" };
    if (ffmpeg.isLoading) return { state: "off" };
    if (!ffmpeg.data) return { state: "no-ffmpeg" };
    return videos[id] ?? { state: "pending" };
  }

  async function install() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Installing ffmpeg with winget …" });
    try {
      await installFfmpeg();
      toast.style = Toast.Style.Success;
      toast.title = "ffmpeg installed";
      ffmpeg.revalidate();
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "ffmpeg could not be installed";
      toast.message = (err as Error).message;
    }
  }

  const sections = useMemo(() => {
    const nades = (Array.isArray(data) ? data : []).filter(
      (n) => n.map === map && (side === "all" || n.team === side) && (!recommended || n.recommended),
    );
    return NADE_TYPES.map(({ type }) => ({
      type,
      // Recommended lineups first, otherwise keep the order of the site
      nades: nades.filter((n) => n.type === type).sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    })).filter((s) => s.nades.length > 0);
  }, [data, map, side, recommended]);

  const filterActions = (
    <ActionPanel.Section title="Filter">
      <Action
        title={`Show ${SIDE_TITLE[NEXT_SIDE[side]]}`}
        icon={Icon.TwoPeople}
        shortcut={shortcut("t", true)}
        onAction={() => setSide(NEXT_SIDE[side])}
      />
      <Action
        title={recommended ? "Show All Lineups" : "Show Only Recommended"}
        icon={Icon.Star}
        shortcut={shortcut("e", true)}
        onAction={() => setRecommended(!recommended)}
      />
      <Action
        title="Reload"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={revalidate}
      />
    </ActionPanel.Section>
  );

  const filterText = [SIDE_TITLE[side], recommended ? "recommended only" : ""].filter(Boolean).join(" · ");

  return (
    <List
      isLoading={isLoading || map === ""}
      isShowingDetail={sections.length > 0}
      onSelectionChange={setSelectedId}
      navigationTitle={map ? `${mapName(map)} – ${filterText}` : "CS2 Nades"}
      searchBarPlaceholder="Search target or position, e.g. Jungle, Window, CT …"
      searchBarAccessory={
        <List.Dropdown tooltip="Map" storeValue onChange={setMap}>
          <List.Dropdown.Section title="Premier Map Pool">
            {PREMIER_MAPS.map((m) => (
              <List.Dropdown.Item key={m.slug} title={m.name} value={m.slug} />
            ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Other Maps">
            {OTHER_MAPS.map((m) => (
              <List.Dropdown.Item key={m.slug} title={m.name} value={m.slug} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {error && sections.length === 0 ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="csnades.gg Not Reachable"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
              <Action.OpenInBrowser title="Open csnades.gg" url={`${SITE}/${map}`} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Lineups"
          description={recommended ? "This map has no recommended lineups – Ctrl+Shift+E shows all" : undefined}
          actions={<ActionPanel>{filterActions}</ActionPanel>}
        />
      )}
      {sections.map((s) => (
        <List.Section key={s.type} title={typeTitle(s.type)} subtitle={String(s.nades.length)}>
          {s.nades.map((n) => (
            <List.Item
              key={n.id}
              id={n.id}
              title={n.to}
              subtitle={`from ${n.from}`}
              keywords={[n.from, n.team, typeTitle(n.type)]}
              icon={n.recommended ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Circle}
              accessories={[{ tag: teamTag(n.team) }]}
              detail={<NadeDetail nade={n} video={videoOf(n.id)} />}
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    <Action.OpenInBrowser title="Play Video" icon={Icon.Play} url={n.videoHq} />
                    <Action.OpenInBrowser
                      title="Open on csnades.gg"
                      icon={Icon.Globe}
                      url={n.url}
                      shortcut={Keyboard.Shortcut.Common.Open}
                    />
                    <Action.OpenInBrowser
                      title="Play Low Quality Video"
                      icon={Icon.Video}
                      url={n.videoLq}
                      shortcut={shortcut("l")}
                    />
                    <Action.OpenInBrowser
                      title="Open Lineup Picture"
                      icon={Icon.Image}
                      url={n.lineup}
                      shortcut={shortcut("i")}
                    />
                    <Action.CopyToClipboard
                      title="Copy Link"
                      content={n.url}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                    {inlineVideo && !ffmpeg.isLoading && !ffmpeg.data && canInstallFfmpeg && (
                      <Action
                        title="Install ffmpeg"
                        icon={Icon.Download}
                        shortcut={shortcut("f", true)}
                        onAction={install}
                      />
                    )}
                  </ActionPanel.Section>
                  {filterActions}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
