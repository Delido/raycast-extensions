export const DEFAULT_PATH =
  "/opt/homebrew/opt/llvm/bin:/opt/local/bin:/opt/local/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/Library/Apple/usr/bin";

export const IS_WINDOWS = process.platform === "win32";

// On Windows the macOS PATH would hide curl, python, ddgs etc., so keep the system PATH
export const DEFAULT_ENV = IS_WINDOWS
  ? { ...process.env }
  : {
      ...process.env,
      PATH: DEFAULT_PATH,
    };

// Adds the Homebrew locations to PATH on macOS; leaves PATH untouched on Windows
export const withHomebrewPath = (env = process.env) =>
  IS_WINDOWS ? { ...env } : { ...env, PATH: `${env.PATH}:/opt/homebrew/bin/:/usr/local/bin/` };
