/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Ticket property badges (read-only) and dropdowns, built on Plane's property-select blocks so tickets
// look and behave like work item properties.

import { useCallback } from "react";
import { Avatar } from "@makeplane/propel/components/avatar";
import { MembersOutline, PriorityOutline, StateOutline } from "@makeplane/propel/icons";
import { PriorityIcon, StateGroupIcon } from "@plane/blocks/icons";
import type { MemberOption, StateOption } from "@plane/blocks/property-select";
import { MemberSelect, StateSelect } from "@plane/blocks/property-select";
import type { SelectVariant } from "@plane/blocks/select";
import type { ReactElement } from "react";
import { Select } from "@plane/blocks/select";
import type { TIssuePriorities, TStateGroups } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
import type { TTicketMeta, TTicketPriority, TTicketStatus, TTicketUser } from "./types";

const PILL =
  "inline-flex h-6 items-center gap-1.5 rounded-sm border-[0.5px] border-strong px-2 text-caption-md-regular";

export const toMemberOption = (user: TTicketUser): MemberOption => ({
  id: user.id,
  display_name: user.name || user.display_name,
  name: user.name,
  avatar_url: getFileURL(user.avatar_url ?? ""),
});

const toStateOption = (status: TTicketStatus, index: number): StateOption => ({
  id: status.id,
  name: status.name,
  color: status.color,
  group: status.group as TStateGroups,
  order: index,
});

// ---------------------------------------------------------------- read-only badges

export function TicketStateBadge(props: { state: TTicketStatus | null; bordered?: boolean }) {
  const { state, bordered = true } = props;
  return (
    <span className={cn(bordered ? PILL : "inline-flex items-center gap-1.5 text-body-xs-regular", "text-secondary")}>
      {state ? (
        <StateGroupIcon stateGroup={state.group as TStateGroups} color={state.color} size="sm" />
      ) : (
        <StateOutline className="size-3.5" />
      )}
      <span className="truncate">{state?.name ?? "No status"}</span>
    </span>
  );
}

export function TicketPriorityBadge(props: {
  priority: TTicketPriority | null | undefined;
  label?: string | null;
  bordered?: boolean;
}) {
  const { priority, label, bordered = true } = props;
  return (
    <span className={cn(bordered ? PILL : "inline-flex items-center gap-1.5 text-body-xs-regular", "text-secondary")}>
      <PriorityIcon priority={(priority ?? "none") as TIssuePriorities} className="size-3.5" />
      <span className="truncate">{label || "None"}</span>
    </span>
  );
}

export function TicketMemberBadge(props: { user: TTicketUser | null | undefined; bordered?: boolean; empty?: string }) {
  const { user, bordered = false, empty = "Unassigned" } = props;
  return (
    <span
      className={cn(
        bordered ? PILL : "inline-flex items-center gap-1.5 text-body-xs-regular",
        user ? "text-secondary" : "text-placeholder"
      )}
    >
      {user ? (
        <Avatar size="xs" src={getFileURL(user.avatar_url ?? "")} alt={user.name || user.display_name} />
      ) : (
        <MembersOutline className="size-3.5" />
      )}
      <span className="truncate">{user ? user.name || user.display_name : empty}</span>
    </span>
  );
}

// ---------------------------------------------------------------- dropdowns

type TStatusSelectProps = {
  meta: TTicketMeta;
  value: string;
  onChange: (id: string) => void;
  variant?: SelectVariant;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
};

export function TicketStatusSelect(props: TStatusSelectProps) {
  const { meta, value, onChange, variant = "pill-md", invalid, placeholder = "Status", className } = props;
  const getValues = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = meta.statuses
        .map(toStateOption)
        .filter((state) => !query || state.name.toLowerCase().includes(query));
      return { results, next_page_results: false };
    },
    [meta.statuses]
  );
  const index = meta.statuses.findIndex((s) => s.id === value);
  const selected = index >= 0 ? toStateOption(meta.statuses[index], index) : null;
  return (
    <StateSelect
      getValues={getValues}
      value={selected}
      onChange={onChange}
      variant={variant}
      placeholder={placeholder}
      className={cn(invalid && "text-danger-primary", className)}
    />
  );
}

type TOption = { value: string; label: string };

type TChoiceSelectProps = {
  options: TOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: React.ReactNode | ((value: string) => React.ReactNode);
  variant?: SelectVariant;
  allowClear?: boolean;
  invalid?: boolean;
  showSearch?: boolean;
  className?: string;
};

/** Single-choice dropdown (priority, category, tool category, trial). An empty value means "Select an Option". */
export function TicketChoiceSelect(props: TChoiceSelectProps) {
  const {
    options,
    value,
    onChange,
    placeholder,
    icon,
    variant = "pill-md",
    allowClear = true,
    invalid,
    showSearch = false,
    className,
  } = props;
  const all: TOption[] = allowClear ? [{ value: "", label: "Select an Option" }, ...options] : options;
  const selected = options.find((o) => o.value === value) ?? null;
  const renderIcon = (v: string) => (typeof icon === "function" ? icon(v) : icon);
  return (
    <Select<TOption>
      getValues={() => all}
      value={selected}
      onChange={onChange}
      getOptionValue={(o) => o.value}
      getOptionLabel={(o) => o.label}
      getOptionIcon={typeof icon === "function" ? (o) => (o.value ? renderIcon(o.value) : null) : undefined}
      showSearch={showSearch}
      pinSelected={false}
    >
      <Select.Trigger
        variant={variant}
        appendIcon={variant.startsWith("select") ? undefined : null}
        className={cn(invalid && "text-danger-primary", className)}
        prependIcon={icon ? (renderIcon(value) as ReactElement<{ className?: string }>) : undefined}
      >
        <span className="flex min-w-0 grow items-center truncate text-left">
          {selected ? (
            selected.label
          ) : (
            <span className={invalid ? "text-danger-primary" : "text-placeholder"}>{placeholder}</span>
          )}
        </span>
      </Select.Trigger>
    </Select>
  );
}

export function TicketPrioritySelect(props: {
  meta: TTicketMeta;
  value: string;
  onChange: (value: string) => void;
  variant?: SelectVariant;
  placeholder?: string;
  className?: string;
}) {
  const { meta, value, onChange, variant, placeholder = "Priority", className } = props;
  return (
    <TicketChoiceSelect
      options={meta.priorities}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      variant={variant}
      className={className}
      icon={(v) =>
        v ? (
          <PriorityIcon priority={v as TIssuePriorities} className="size-3.5" />
        ) : (
          <PriorityOutline className="size-3.5 text-tertiary" />
        )
      }
    />
  );
}

export function TicketMemberSelect(props: {
  meta: TTicketMeta;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  variant?: SelectVariant;
  invalid?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const { meta, value, onChange, placeholder, variant = "pill-md", invalid, clearable = true, className } = props;
  const getValues = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = meta.members
        .filter((m) => !query || `${m.name} ${m.display_name}`.toLowerCase().includes(query))
        .map(toMemberOption);
      return { results, next_page_results: false };
    },
    [meta.members]
  );
  const member = meta.members.find((m) => m.id === value);
  return (
    <MemberSelect
      getValues={getValues}
      value={member ? toMemberOption(member) : null}
      onChange={onChange}
      variant={variant}
      placeholder={placeholder}
      searchPlaceholder="Type to search"
      clearable={clearable}
      clearLabel="Clear"
      className={cn(invalid && "text-danger-primary", className)}
    />
  );
}
