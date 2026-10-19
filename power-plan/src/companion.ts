/*
 * Tells the companion helper of the SignalRGB extension whether a game runs, so it can switch the
 * keyboard's hardware game mode. Best effort: nothing happens if the helper isn't running.
 */
export async function reportGameToCompanion(game: string | undefined) {
  try {
    await fetch("http://127.0.0.1:3010/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !!game, name: game ?? "" }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // helper not running
  }
}
