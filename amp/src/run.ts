import { Alert, confirmAlert, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";

export interface RunOptions {
  /** Shown as toast message and alert body, e.g. the instance name. */
  subject?: string;
  /** Ask before running. */
  confirm?: { title: string; message?: string; destructive?: boolean };
  /** Called after the task succeeded. */
  onSuccess?: () => void;
  successTitle?: string;
}

/** Runs an AMP action with optional confirmation and progress/success/failure toasts. */
export async function runAction(
  label: string,
  task: () => Promise<unknown>,
  options: RunOptions = {},
): Promise<boolean> {
  const { subject, confirm, onSuccess, successTitle } = options;
  if (confirm) {
    const confirmed = await confirmAlert({
      title: confirm.title,
      message: confirm.message ?? subject,
      primaryAction: {
        title: label,
        style: confirm.destructive ? Alert.ActionStyle.Destructive : Alert.ActionStyle.Default,
      },
    });
    if (!confirmed) return false;
  }

  const toast = await showToast({ style: Toast.Style.Animated, title: `${label}…`, message: subject });
  try {
    await task();
    toast.style = Toast.Style.Success;
    toast.title = successTitle ?? `${label}: done`;
    onSuccess?.();
    return true;
  } catch (error) {
    await toast.hide();
    await showFailureToast(error, { title: `${label} failed` });
    return false;
  }
}

export function formatBytes(bytes?: number): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes)) return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
