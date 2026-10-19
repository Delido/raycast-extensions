import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import {
  Asset,
  assetTitle,
  assignedName,
  checkinAsset,
  checkoutAsset,
  dateText,
  decode,
  License,
  list,
  primaryShortcut,
  Ref,
  request,
  Rows,
  StockItem,
  statusColor,
  statusText,
  toDate,
  User,
  webUrl,
} from "./api";

// ---------- Assets ----------

export function AssetItem({ asset, onChange }: { asset: Asset; onChange: () => void }) {
  const status = statusText(asset);
  return (
    <List.Item
      icon={{ source: Icon.ComputerChip, tintColor: statusColor(asset.status_label) }}
      title={assetTitle(asset)}
      subtitle={[asset.asset_tag, decode(asset.model?.name)].filter(Boolean).join(" · ")}
      keywords={[asset.asset_tag, asset.serial ?? "", assignedName(asset.assigned_to)]}
      accessories={[
        ...(asset.location ? [{ icon: Icon.Pin, text: decode(asset.location.name), tooltip: "Location" }] : []),
        ...(status ? [{ tag: { value: status, color: statusColor(asset.status_label) } }] : []),
      ]}
      actions={<AssetActions asset={asset} onChange={onChange} />}
    />
  );
}

export function AssetActions({
  asset,
  onChange,
  inDetail,
}: {
  asset: Asset;
  onChange: () => void;
  inDetail?: boolean;
}) {
  const url = webUrl("hardware", asset.id);
  // available_actions reflects the user's permissions; fall back to the assignment state.
  const canCheckout = asset.available_actions?.checkout ?? !asset.assigned_to;
  const canCheckin = asset.available_actions?.checkin ?? !!asset.assigned_to;
  return (
    <ActionPanel>
      {!inDetail && (
        <Action.Push
          title="Show Details"
          icon={Icon.Sidebar}
          target={<AssetDetail asset={asset} onChange={onChange} />}
        />
      )}
      <Action.OpenInBrowser title="Open in Snipe-IT" url={url} />
      <ActionPanel.Section>
        {canCheckout && !asset.assigned_to && (
          <Action.Push
            title="Check out"
            icon={Icon.ArrowRightCircle}
            shortcut={primaryShortcut("o", true)}
            target={<CheckoutForm asset={asset} onDone={onChange} />}
          />
        )}
        {canCheckin && asset.assigned_to && (
          <Action.Push
            title="Check in"
            icon={Icon.ArrowLeftCircle}
            shortcut={primaryShortcut("i", true)}
            target={<CheckinForm asset={asset} onDone={onChange} />}
          />
        )}
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy Asset Tag"
          content={asset.asset_tag}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        {asset.serial && (
          <Action.CopyToClipboard
            title="Copy Serial Number"
            content={asset.serial}
            shortcut={Keyboard.Shortcut.Common.CopyName}
          />
        )}
        <Action.CopyToClipboard title="Copy URL" content={url} />
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onChange}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

export function AssetDetail({ asset: initial, onChange }: { asset: Asset; onChange: () => void }) {
  // Reload the full asset (includes custom fields) and keep it fresh after check-in/out.
  const { data, isLoading, revalidate } = usePromise(
    (id: number) => request<Asset>("GET", `hardware/${id}`),
    [initial.id],
  );
  const asset = data ?? initial;
  const customFields = Array.isArray(asset.custom_fields) ? [] : Object.entries(asset.custom_fields ?? {});
  const warranty = toDate(asset.warranty_expires);
  const warrantyExpired = warranty && warranty.getTime() < Date.now();

  const markdown = [
    `# ${assetTitle(asset)}`,
    asset.image ? `<img src="${asset.image}" height="160" />` : "",
    asset.notes ? `### Notes\n${decode(asset.notes)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={asset.asset_tag}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Asset Tag" text={asset.asset_tag} />
          {asset.serial && <Detail.Metadata.Label title="Serial" text={asset.serial} />}
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item
              text={decode(asset.status_label?.name) || "-"}
              color={statusColor(asset.status_label)}
            />
          </Detail.Metadata.TagList>
          {asset.assigned_to && (
            <Detail.Metadata.Label title="Assigned To" text={assignedName(asset.assigned_to)} icon={Icon.Person} />
          )}
          {asset.location && <Detail.Metadata.Label title="Location" text={decode(asset.location.name)} />}
          {asset.rtd_location && (
            <Detail.Metadata.Label title="Default Location" text={decode(asset.rtd_location.name)} />
          )}
          <Detail.Metadata.Separator />
          {asset.model && <Detail.Metadata.Label title="Model" text={decode(asset.model.name)} />}
          {asset.model_number && <Detail.Metadata.Label title="Model No." text={asset.model_number} />}
          {asset.category && <Detail.Metadata.Label title="Category" text={decode(asset.category.name)} />}
          {asset.manufacturer && <Detail.Metadata.Label title="Manufacturer" text={decode(asset.manufacturer.name)} />}
          {asset.company && <Detail.Metadata.Label title="Company" text={decode(asset.company.name)} />}
          <Detail.Metadata.Separator />
          {asset.purchase_date && <Detail.Metadata.Label title="Purchased" text={dateText(asset.purchase_date)} />}
          {asset.purchase_cost && <Detail.Metadata.Label title="Cost" text={asset.purchase_cost} />}
          {asset.supplier && <Detail.Metadata.Label title="Supplier" text={decode(asset.supplier.name)} />}
          {asset.order_number && <Detail.Metadata.Label title="Order No." text={asset.order_number} />}
          {asset.warranty_expires && (
            <Detail.Metadata.TagList title="Warranty Until">
              <Detail.Metadata.TagList.Item
                text={dateText(asset.warranty_expires)}
                color={warrantyExpired ? Color.Red : Color.Green}
              />
            </Detail.Metadata.TagList>
          )}
          {asset.last_audit_date && <Detail.Metadata.Label title="Last Audit" text={dateText(asset.last_audit_date)} />}
          {asset.next_audit_date && <Detail.Metadata.Label title="Next Audit" text={dateText(asset.next_audit_date)} />}
          {asset.expected_checkin && (
            <Detail.Metadata.Label title="Expected Check-in" text={dateText(asset.expected_checkin)} />
          )}
          {customFields.length > 0 && <Detail.Metadata.Separator />}
          {customFields
            .filter(([, f]) => f.value)
            .map(([label, f]) => (
              <Detail.Metadata.Label key={label} title={decode(label)} text={decode(f.value)} />
            ))}
        </Detail.Metadata>
      }
      actions={
        <AssetActions
          asset={asset}
          inDetail
          onChange={() => {
            revalidate();
            onChange();
          }}
        />
      }
    />
  );
}

function useSearch<T>(path: string, text: string) {
  return usePromise(
    async (path: string, text: string) => (await list<T>(path, { search: text, limit: 30 })).rows,
    [path, text],
  );
}

export function CheckoutForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const { pop } = useNavigation();
  const [targetType, setTargetType] = useState<"user" | "location">("user");
  const [searchText, setSearchText] = useState("");
  const users = useSearch<User>("users", targetType === "user" ? searchText : "");
  const locations = useSearch<Ref>("locations", targetType === "location" ? searchText : "");
  const options = targetType === "user" ? users : locations;

  return (
    <Form
      navigationTitle={`Check out ${asset.asset_tag}`}
      isLoading={options.isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Check out"
            icon={Icon.ArrowRightCircle}
            onSubmit={async (values: { target: string; note: string; expected: Date | null }) => {
              if (!values.target) {
                await showToast({ style: Toast.Style.Failure, title: `Select a ${targetType}` });
                return;
              }
              const toast = await showToast({ style: Toast.Style.Animated, title: "Checking out…" });
              try {
                await checkoutAsset(
                  asset.id,
                  { type: targetType, id: Number(values.target) },
                  values.note,
                  values.expected,
                );
                toast.style = Toast.Style.Success;
                toast.title = `${asset.asset_tag} checked out`;
                onDone();
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Check-out failed";
                toast.message = (error as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Asset" text={`${asset.asset_tag} – ${assetTitle(asset)}`} />
      <Form.Dropdown
        id="type"
        title="Check out to"
        value={targetType}
        onChange={(v) => setTargetType(v as "user" | "location")}
      >
        <Form.Dropdown.Item value="user" title="User" icon={Icon.Person} />
        <Form.Dropdown.Item value="location" title="Location" icon={Icon.Pin} />
      </Form.Dropdown>
      <Form.Dropdown
        id="target"
        title={targetType === "user" ? "User" : "Location"}
        filtering={false}
        throttle
        onSearchTextChange={setSearchText}
        isLoading={options.isLoading}
      >
        {(options.data ?? []).map((item) => (
          <Form.Dropdown.Item
            key={item.id}
            value={String(item.id)}
            title={decode(item.name)}
            icon={targetType === "user" ? Icon.Person : Icon.Pin}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker id="expected" title="Expected Check-in" type={Form.DatePicker.Type.Date} />
      <Form.TextArea id="note" title="Note" placeholder="Optional" />
    </Form>
  );
}

export function CheckinForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={`Check in ${asset.asset_tag}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Check in"
            icon={Icon.ArrowLeftCircle}
            onSubmit={async (values: { note: string }) => {
              const toast = await showToast({ style: Toast.Style.Animated, title: "Checking in…" });
              try {
                await checkinAsset(asset.id, values.note);
                toast.style = Toast.Style.Success;
                toast.title = `${asset.asset_tag} checked in`;
                onDone();
                pop();
              } catch (error) {
                toast.style = Toast.Style.Failure;
                toast.title = "Check-in failed";
                toast.message = (error as Error).message;
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Asset" text={`${asset.asset_tag} – ${assetTitle(asset)}`} />
      <Form.Description title="Assigned To" text={assignedName(asset.assigned_to) || "-"} />
      <Form.TextArea id="note" title="Note" placeholder="Optional" />
    </Form>
  );
}

// ---------- Users ----------

export function UserItems({ user }: { user: User }) {
  const { data, isLoading, revalidate } = usePromise(
    async (id: number) => {
      const [assets, licenses, accessories] = await Promise.all([
        request<Rows<Asset>>("GET", `users/${id}/assets`).catch(() => ({ rows: [] as Asset[], total: 0 })),
        request<Rows<License>>("GET", `users/${id}/licenses`).catch(() => ({ rows: [] as License[], total: 0 })),
        request<Rows<StockItem>>("GET", `users/${id}/accessories`).catch(() => ({ rows: [] as StockItem[], total: 0 })),
      ]);
      return { assets: assets.rows, licenses: licenses.rows, accessories: accessories.rows };
    },
    [user.id],
  );

  return (
    <List
      isLoading={isLoading}
      navigationTitle={decode(user.name)}
      searchBarPlaceholder={`Filter items of ${decode(user.name)}...`}
    >
      <List.Section title="Assets" subtitle={String(data?.assets.length ?? "")}>
        {data?.assets.map((asset) => (
          <AssetItem key={asset.id} asset={asset} onChange={revalidate} />
        ))}
      </List.Section>
      <List.Section title="Licenses" subtitle={String(data?.licenses.length ?? "")}>
        {data?.licenses.map((license) => (
          <List.Item
            key={license.id}
            icon={Icon.Key}
            title={decode(license.name)}
            subtitle={decode(license.manufacturer?.name)}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open in Snipe-IT" url={webUrl("licenses", license.id)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Accessories" subtitle={String(data?.accessories.length ?? "")}>
        {data?.accessories.map((item) => (
          <List.Item
            key={item.id}
            icon={Icon.Keyboard}
            title={decode(item.name)}
            subtitle={decode(item.category?.name)}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open in Snipe-IT" url={webUrl("accessories", item.id)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.EmptyView title="Nothing assigned" icon={Icon.Person} />
    </List>
  );
}

export function ErrorEmptyView({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <List.EmptyView
      icon={{ source: Icon.Warning, tintColor: Color.Red }}
      title="Request failed"
      description={error.message}
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={retry} />
          <Action.CopyToClipboard title="Copy Error" content={error.message} />
        </ActionPanel>
      }
    />
  );
}
