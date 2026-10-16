/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Field, FieldLabel } from "@makeplane/propel/components/field";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { TicketService } from "@/services/ticket.service";
// local
import { TICKET_SECTIONS } from "../constants";
import type { TTicketFieldDef } from "../constants";
import {
  TicketChoiceSelect,
  TicketMemberBadge,
  TicketMemberSelect,
  TicketPrioritySelect,
  TicketStatusSelect,
} from "../properties";
import { TicketRichTextField } from "../rich-text-field";
import type { TTicket, TTicketMeta, TTicketPayload } from "../types";

const ticketService = new TicketService();

type TValues = Record<string, string>;
type TErrors = Record<string, string>;

type Props = {
  workspaceSlug: string;
  meta: TTicketMeta;
  ticket?: TTicket; // edit mode
  duplicateFrom?: TTicket; // "Duplicate" action
};

const toValues = (ticket: TTicket | undefined, meta: TTicketMeta): TValues => {
  const values: TValues = {
    name: ticket?.name ?? "",
    assignee_id: ticket?.assignee?.id ?? meta.current_user.id,
    manager_id: ticket?.manager?.id ?? "",
    state_id: ticket?.state?.id ?? "",
    priority: ticket && ticket.priority !== "none" ? ticket.priority : "",
    description_html: ticket?.description_html ?? "",
    solution_html: ticket?.solution_html ?? "",
  };
  TICKET_SECTIONS.forEach((section) =>
    section.rows.flat().forEach((field) => {
      if (field && !(field.key in values)) {
        const raw = ticket ? (ticket as Record<string, unknown>)[field.key] : "";
        values[field.key] = typeof raw === "string" ? raw : "";
      }
    })
  );
  return values;
};

export const TicketForm = observer(function TicketForm(props: Props) {
  const { workspaceSlug, meta, ticket, duplicateFrom } = props;
  const router = useAppRouter();
  const isEdit = !!ticket;
  const initial = useMemo(() => toValues(ticket ?? duplicateFrom, meta), [ticket, duplicateFrom, meta]);
  const [values, setValues] = useState<TValues>(initial);
  const [errors, setErrors] = useState<TErrors>({});
  const [saving, setSaving] = useState(false);

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const validate = (): boolean => {
    const next: TErrors = {};
    TICKET_SECTIONS.forEach((section) =>
      section.rows.flat().forEach((field) => {
        if (field?.required && !(values[field.key] ?? "").trim()) next[field.key] = `${field.label} is required`;
      })
    );
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildPayload = (): TTicketPayload => {
    const payload: Record<string, unknown> = {};
    Object.entries(values).forEach(([key, value]) => {
      if (isEdit && initial[key] === value) return;
      if (["category", "tool_category", "trial_tested", "priority"].includes(key)) payload[key] = value || null;
      else payload[key] = value;
    });
    return payload as TTicketPayload;
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    try {
      if (isEdit && ticket) {
        const payload = buildPayload();
        const updated = Object.keys(payload).length
          ? await ticketService.update(workspaceSlug, ticket.id, payload)
          : ticket;
        setToast({ type: "success", title: "Ticket saved", message: `${ticket.ticket_number} was updated.` });
        if ("visible" in updated && updated.visible === false) router.push(`/${workspaceSlug}/tickets`);
        else router.push(`/${workspaceSlug}/tickets/${ticket.id}`);
      } else {
        const created = await ticketService.create(workspaceSlug, buildPayload());
        setToast({ type: "success", title: "Ticket created", message: `${created.ticket_number} was created.` });
        router.push(`/${workspaceSlug}/tickets/${created.id}`);
      }
    } catch (error) {
      const data = (error ?? {}) as Record<string, string[] | string>;
      const fieldErrors: TErrors = {};
      Object.entries(data).forEach(([key, value]) => {
        fieldErrors[key] = Array.isArray(value) ? value.join(" ") : String(value);
      });
      setErrors(fieldErrors);
      setToast({
        type: "error",
        title: "Ticket not saved",
        message: (typeof data.error === "string" && data.error) || "Please correct the highlighted fields.",
      });
    } finally {
      setSaving(false);
    }
  };

  const cancelHref = isEdit ? `/${workspaceSlug}/tickets/${ticket?.id}` : `/${workspaceSlug}/tickets`;

  const actions = (
    <div className="flex items-center gap-2">
      <Link href={cancelHref}>
        <Button stretch="auto" variant="secondary" size="md" label="Cancel" />
      </Link>
      <Button
        stretch="auto"
        variant="primary"
        size="md"
        label={isEdit ? "Save changes" : "Save"}
        loading={saving}
        onClick={() => handleSubmit()}
      />
    </div>
  );

  const renderControl = (field: TTicketFieldDef) => {
    const value = values[field.key] ?? "";
    const invalid = !!errors[field.key];
    switch (field.kind) {
      case "text":
        return (
          <InputGroup size="lg">
            <Input
              size="lg"
              id={`ticket-${field.key}`}
              value={value}
              maxLength={field.maxLength}
              placeholder={field.key === "name" ? "Ticket title" : undefined}
              onChange={(e) => setValue(field.key, e.target.value)}
            />
          </InputGroup>
        );
      case "textarea":
        return (
          <TextAreaGroup resize="vertical">
            <TextArea
              size="lg"
              surface="field"
              autoResize
              maxRows={10}
              id={`ticket-${field.key}`}
              value={value}
              onChange={(e) => setValue(field.key, e.target.value)}
            />
          </TextAreaGroup>
        );
      case "status":
        return (
          <TicketStatusSelect
            meta={meta}
            value={value}
            onChange={(v) => setValue(field.key, v)}
            variant="select-lg"
            invalid={invalid}
            placeholder="Select an Option"
            className="w-full"
          />
        );
      case "priority":
        return (
          <TicketPrioritySelect
            meta={meta}
            value={value}
            onChange={(v) => setValue(field.key, v)}
            variant="select-lg"
            placeholder="Select an Option"
            className="w-full"
          />
        );
      case "choice":
        return (
          <TicketChoiceSelect
            options={(field.options ? meta[field.options] : []).map((o) => ({ value: o, label: o }))}
            value={value}
            onChange={(v) => setValue(field.key, v)}
            placeholder="Select an Option"
            variant="select-lg"
            className="w-full"
          />
        );
      case "member":
        return (
          <TicketMemberSelect
            meta={meta}
            value={value}
            onChange={(id) => setValue(field.key, id)}
            placeholder="Type to search"
            variant="select-lg"
            invalid={invalid}
            className="w-full"
          />
        );
      case "readonly-creator":
        return (
          <div className="flex h-8 items-center rounded-md border-[0.5px] border-subtle bg-layer-1 px-2.5">
            <TicketMemberBadge user={ticket?.created_by ?? meta.current_user} />
          </div>
        );
      case "richtext":
        return (
          <TicketRichTextField
            id={`ticket-${field.key}-${ticket?.id ?? "new"}`}
            workspaceSlug={workspaceSlug}
            value={value}
            editable
            onChange={(html) => setValue(field.key, html)}
          />
        );
      default:
        return null;
    }
  };

  const DROPDOWN_KINDS = ["status", "priority", "choice", "member"];
  const renderField = (field: TTicketFieldDef) => (
    <Field key={field.key} name={field.key} invalid={!!errors[field.key]}>
      <div className="flex flex-col gap-1.5">
        <FieldLabel size="md" inset={false} required={field.required}>
          {field.label}
        </FieldLabel>
        {DROPDOWN_KINDS.includes(field.kind) ? (
          <div
            className={cn(
              "rounded-md border-[0.5px] bg-surface-1 transition-colors hover:border-strong",
              errors[field.key] ? "border-danger-strong" : "border-subtle"
            )}
          >
            {renderControl(field)}
          </div>
        ) : (
          renderControl(field)
        )}
        {errors[field.key] && <span className="text-caption-md-regular text-danger-primary">{errors[field.key]}</span>}
      </div>
    </Field>
  );

  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-page-x py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-h5-semibold text-primary">
              {isEdit ? `Edit ticket ${ticket?.ticket_number}` : duplicateFrom ? "Duplicate ticket" : "Create ticket"}
            </h3>
            <p className="text-body-xs-regular text-tertiary">
              {isEdit ? ticket?.name : "Fields marked with * are required."}
            </p>
          </div>
          {actions}
        </div>

        {TICKET_SECTIONS.map((section) => (
          <section key={section.title} className="rounded-lg border-[0.5px] border-subtle bg-surface-1">
            <h4 className="border-b-[0.5px] border-subtle px-5 py-3 text-body-sm-medium text-primary">
              {section.title}
            </h4>
            <div className={cn("grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5", !section.fullWidth && "md:grid-cols-2")}>
              {section.rows.flat().map((field, index) =>
                field ? (
                  renderField(field)
                ) : (
                  // oxlint-disable-next-line react/no-array-index-key
                  <div key={`empty-${index}`} />
                )
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 mt-auto border-t-[0.5px] border-subtle bg-surface-1">
        <div className="mx-auto flex w-full max-w-[1100px] justify-end px-page-x py-3">{actions}</div>
      </div>
      <button type="submit" className="hidden" tabIndex={-1} />
    </form>
  );
});
