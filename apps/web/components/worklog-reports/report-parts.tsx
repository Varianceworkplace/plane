/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Menu, MenuContent, MenuItem } from "@makeplane/propel/components/menu";
import { SplitButton } from "@makeplane/propel/components/split-button";
import { getFileURL } from "@plane/utils";
// components
import { getWorklogUserName } from "@/components/worklogs/helpers";
import type { TWorklogUser } from "@/components/worklogs/types";

// wide tables scroll sideways on narrow screens instead of being cut off
export const TABLE_CLASSNAME = "overflow-x-auto rounded-lg border-[0.5px] border-subtle";
export const HEAD_CELL = "px-3 py-2.5 font-medium";
export const ROW_CLASSNAME =
  "cursor-pointer border-t-[0.5px] border-subtle text-body-xs-regular text-primary hover:bg-layer-transparent-hover";

export function UserCell({ user }: { user: TWorklogUser }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar size="xs" src={getFileURL(user.avatar_url ?? "")} alt={getWorklogUserName(user)} />
      <span className="truncate font-medium">{getWorklogUserName(user)}</span>
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-lg border-[0.5px] border-subtle bg-layer-1 px-4 py-3">
      <span className="text-body-xs-regular text-tertiary">{label}</span>
      <span className="text-h5-semibold text-primary">{value}</span>
    </div>
  );
}

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-sm-medium text-primary">{title}</h3>
        <div className="flex items-center gap-3">
          {hint && <span className="text-body-xs-regular text-placeholder">{hint}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

export type TReportExportFormat = "csv" | "xlsx" | "pdf";

const EXPORT_LABELS: Record<TReportExportFormat, string> = {
  csv: "Export as CSV",
  xlsx: "Export as Excel",
  pdf: "Export as PDF",
};

/** Export split button: the main click exports the first format, the menu lists them all. */
export function ReportExportMenu<T extends TReportExportFormat = "csv" | "xlsx">({
  disabled,
  onExport,
  formats = ["csv", "xlsx"] as T[],
}: {
  disabled: boolean;
  onExport: (format: T) => void;
  formats?: T[];
}) {
  return (
    <Menu>
      <SplitButton
        variant="primary"
        size="md"
        label="Export"
        menuLabel="Choose export format"
        disabled={disabled}
        onClick={() => onExport(formats[0])}
      />
      <MenuContent side="bottom" align="end">
        {formats.map((format) => (
          <MenuItem key={format} label={EXPORT_LABELS[format]} onClick={() => onExport(format)} />
        ))}
      </MenuContent>
    </Menu>
  );
}

/** Shown to members, who only ever see their own time. */
export function OwnTimeNotice() {
  return (
    <p className="text-body-xs-regular text-tertiary">
      You see the time you logged yourself. Project admins see their whole team.
    </p>
  );
}
