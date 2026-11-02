/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
// plane imports
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Select } from "@plane/blocks/select";
import { cn } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
// local imports
import type { TTaskDetail, TTaskDetailField, TTaskDetailOptions } from "./types";

export type TOption = { id: string; label: string };

/** "" is the "None" row of every picklist */
const NONE: TOption = { id: "", label: "None" };

type Props = {
  field: TTaskDetailField;
  value: TTaskDetail[keyof TTaskDetail];
  options: TTaskDetailOptions | undefined;
  onChange: (value: TTaskDetail[keyof TTaskDetail]) => void;
  /**
   * `form`: bordered controls that report every keystroke (create form).
   * `inline`: ghost controls for the sidebar; text is only reported when the field loses focus.
   */
  mode: "form" | "inline";
  disabled?: boolean;
  invalid?: boolean;
};

export function PicklistSelect(props: {
  options: TOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  mode: "form" | "inline";
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { options, value, onChange, placeholder, mode, disabled, invalid } = props;
  const selected = options.find((option) => option.id === value) ?? null;
  const select = (
    <Select<TOption>
      getValues={() => (value ? [NONE, ...options] : options)}
      value={selected}
      onChange={onChange}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.label}
      showSearch={options.length > 8}
      searchPlaceholder="Search"
      pinSelected={false}
      disabled={disabled}
    >
      <Select.Trigger<TOption> variant={mode === "form" ? "select-md" : "select-ghost-md"} className="w-full">
        <span className={cn("truncate text-left", !selected && "text-placeholder")}>
          {selected?.label ?? placeholder}
        </span>
      </Select.Trigger>
    </Select>
  );
  if (mode === "inline") return select;
  return (
    <div className={cn("rounded-md border-[0.5px]", invalid ? "border-danger-strong" : "border-subtle")}>{select}</div>
  );
}

/** One Project Task field, rendered by its kind. */
export function TaskDetailFieldInput(props: Props) {
  const { field, value, options, onChange, mode, disabled = false, invalid = false } = props;
  // text kinds keep a draft so the sidebar saves once, on blur
  const [draft, setDraft] = useState(typeof value === "string" ? value : "");
  useEffect(() => {
    if (typeof value === "string") setDraft(value);
  }, [value]);

  const commitText = () => {
    if (mode === "inline" && draft.trim() !== String(value ?? "").trim()) onChange(draft.trim());
  };
  const placeholder = mode === "inline" ? "None" : `Select ${field.label.toLowerCase()}`;

  switch (field.kind) {
    case "select":
      return (
        <PicklistSelect
          options={(options?.[field.key] ?? []).map((option) => ({ id: option, label: option }))}
          value={(value as string) ?? ""}
          onChange={onChange}
          placeholder={placeholder}
          mode={mode}
          disabled={disabled}
          invalid={invalid}
        />
      );
    case "progress":
      return (
        <PicklistSelect
          options={(options?.progress ?? []).map((option) => ({ id: String(option), label: `${option}%` }))}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(id) => onChange(id ? Number(id) : null)}
          placeholder={placeholder}
          mode={mode}
          disabled={disabled}
          invalid={invalid}
        />
      );
    case "yes-no":
      return (
        <PicklistSelect
          options={[
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ]}
          value={value === true ? "yes" : value === false ? "no" : ""}
          onChange={(id) => onChange(id === "yes" ? true : id === "no" ? false : null)}
          placeholder={placeholder}
          mode={mode}
          disabled={disabled}
          invalid={invalid}
        />
      );
    case "member":
      return (
        <div className={cn(mode === "form" && "rounded-md border-[0.5px] border-subtle")}>
          <MemberSelect
            value={(value as string | null) ?? null}
            onChange={(id) => onChange(id || null)}
            variant={mode === "form" ? "select-md" : "select-ghost-md"}
            placeholder={mode === "inline" ? "None" : "Select a person"}
            clearable
            clearLabel="No one"
            disabled={disabled}
            className="w-full"
          />
        </div>
      );
    case "checkbox":
      return (
        <div className={cn("flex h-8 items-center", mode === "inline" && "px-2")}>
          <Checkbox
            checked={!!value}
            onCheckedChange={(checked) => onChange(!!checked)}
            disabled={disabled}
            aria-label={field.label}
            label={mode === "form" ? "Yes" : undefined}
          />
        </div>
      );
    case "textarea":
      return (
        <TextAreaGroup resize="none">
          <TextArea
            size="md"
            surface="field"
            autoResize
            maxRows={6}
            aria-label={field.label}
            placeholder={field.placeholder}
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (mode === "form") onChange(e.target.value);
            }}
            onBlur={commitText}
          />
        </TextAreaGroup>
      );
    case "text":
      return (
        <InputGroup size="md">
          <Input
            size="md"
            aria-label={field.label}
            aria-invalid={invalid || undefined}
            placeholder={field.placeholder}
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (mode === "form") onChange(e.target.value);
            }}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "inline") (e.target as HTMLInputElement).blur();
            }}
          />
        </InputGroup>
      );
  }
}
