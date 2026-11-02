/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import {
  ActivityOutline,
  AttachOutline,
  CalendarOutline,
  ChevronDownOutline,
  ChevronRightOutline,
  DocumentationOutline,
  FileOutline,
  HistoryOutline,
  LockOutline,
  MembersOutline,
  MessageSupportOutline,
  MultiTagOutline,
  PriorityOutline,
  StateOutline,
  TextOutline,
  UserCircleOutline,
  UserOutline,
} from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { calculateTimeAgo, cn, getFileURL, renderFormattedDate } from "@plane/utils";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { TicketService } from "@/services/ticket.service";
// local
import { TICKET_SECTIONS } from "../constants";
import {
  TicketChoiceSelect,
  TicketMemberBadge,
  TicketMemberSelect,
  TicketPriorityBadge,
  TicketPrioritySelect,
  TicketStateBadge,
  TicketStatusSelect,
} from "../properties";
import { TicketRichTextField } from "../rich-text-field";
import type { TTicket, TTicketComment, TTicketHistory, TTicketMeta, TTicketPayload, TTicketUser } from "../types";

const ticketService = new TicketService();

type Props = { workspaceSlug: string; ticketId: string; meta: TTicketMeta };
type TActivityFilter = "all" | "updates" | "comments";

const isEmptyHtml = (html?: string | null) => !html || !html.replace(/<[^>]*>/g, "").trim();
const textValue = (ticket: TTicket, key: string) => {
  const value = (ticket as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

export function TicketDetail(props: Props) {
  const { workspaceSlug, ticketId, meta } = props;
  const router = useAppRouter();
  const {
    data: ticket,
    error,
    mutate,
  } = useSWR(["TICKET", workspaceSlug, ticketId], () => ticketService.retrieve(workspaceSlug, ticketId));

  /** A property changed in place (the assignee only); the server records it in the history. */
  const update = async (payload: TTicketPayload, label: string) => {
    if (!ticket) return;
    try {
      const updated = await ticketService.update(workspaceSlug, ticket.id, payload);
      if ("visible" in updated && updated.visible === false) {
        // reassigned to someone else: this ticket is theirs now
        setToast({
          type: "success",
          title: "Ticket reassigned",
          message: `${ticket.ticket_number} is no longer yours.`,
        });
        router.push(`/${workspaceSlug}/tickets`);
        return;
      }
      await mutate(updated, { revalidate: false });
      setToast({ type: "success", title: `${label} updated`, message: ticket.ticket_number });
    } catch (err) {
      const data = (err ?? {}) as Record<string, string[] | string>;
      const message = Object.values(data).flat()[0];
      setToast({
        type: "error",
        title: `${label} not updated`,
        message: message ? String(message) : "Please try again.",
      });
    }
  };

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <MessageSupportOutline className="size-10 text-placeholder" />
        <p className="text-body-sm-medium text-secondary">
          This ticket does not exist or you do not have access to it.
        </p>
        <Link href={`/${workspaceSlug}/tickets`}>
          <Button stretch="auto" variant="secondary" size="md" label="Back to Tickets" />
        </Link>
      </div>
    );
  if (!ticket)
    return (
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3 px-page-x py-6">
        <div className="h-4 w-20 animate-pulse rounded-sm bg-layer-1" />
        <div className="h-7 w-2/3 animate-pulse rounded-sm bg-layer-1" />
        <div className="h-24 animate-pulse rounded-lg bg-layer-1" />
      </div>
    );

  const editable = ticket.can_edit;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      {/* main content */}
      <div className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-page-x py-6 md:px-9">
          {/* title block */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-caption-md-regular text-tertiary">
              <span className="rounded-sm bg-layer-1 px-1.5 py-0.5 text-caption-md-medium text-secondary tabular-nums">
                {ticket.ticket_number}
              </span>
              <span>
                Raised by <span className="text-secondary">{ticket.created_by?.name ?? "someone"}</span>{" "}
                <span title={renderFormattedDate(ticket.created_at) ?? undefined}>
                  {calculateTimeAgo(ticket.created_at)}
                </span>
              </span>
              {!editable && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-layer-1 px-1.5 py-0.5">
                  <LockOutline className="size-3" /> View only
                </span>
              )}
            </div>
            <h2 className="text-h4-medium break-words text-primary">{ticket.name}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <TicketStateBadge state={ticket.state} />
              <TicketPriorityBadge priority={ticket.priority} label={ticket.priority_label} />
              <span className="inline-flex h-6 items-center rounded-sm border-[0.5px] border-strong px-2">
                <TicketMemberBadge user={ticket.assignee} />
              </span>
              {ticket.category && (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border-[0.5px] border-strong px-2 text-caption-md-regular text-secondary">
                  <MultiTagOutline className="size-3.5" />
                  {ticket.category}
                </span>
              )}
            </div>
          </div>

          <Card icon={TextOutline} title="Description">
            {isEmptyHtml(ticket.description_html) ? (
              <p className="text-body-xs-regular text-placeholder">No description</p>
            ) : (
              <TicketRichTextField
                id={`ticket-description-${ticket.id}`}
                workspaceSlug={workspaceSlug}
                value={ticket.description_html ?? ""}
                editable={false}
              />
            )}
          </Card>

          <AssetRequirementCard ticket={ticket} />

          <Card icon={DocumentationOutline} title="Solution">
            {isEmptyHtml(ticket.solution_html) ? (
              <p className="text-body-xs-regular text-placeholder">No solution yet</p>
            ) : (
              <TicketRichTextField
                id={`ticket-solution-${ticket.id}`}
                workspaceSlug={workspaceSlug}
                value={ticket.solution_html ?? ""}
                editable={false}
              />
            )}
          </Card>

          <DocumentsSection ticket={ticket} workspaceSlug={workspaceSlug} />
          <ActivitySection ticket={ticket} workspaceSlug={workspaceSlug} />
        </div>
      </div>

      {/* properties sidebar: editable in place for the assignee */}
      <aside className="w-full shrink-0 border-t-[0.5px] border-subtle md:w-[340px] md:overflow-y-auto md:border-t-0 md:border-l-[0.5px]">
        <div className="px-6 py-5">
          <h5 className="text-body-xs-medium text-primary">Properties</h5>
          <div className="mt-4 space-y-2.5">
            <SidebarPropertyListItem icon={StateOutline} label="Status">
              {editable ? (
                <TicketStatusSelect
                  meta={meta}
                  value={ticket.state?.id ?? ""}
                  onChange={(id) => id && id !== ticket.state?.id && void update({ state_id: id }, "Status")}
                  variant="select-ghost-md"
                  className="w-full"
                />
              ) : (
                <TicketStateBadge state={ticket.state} bordered={false} />
              )}
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={PriorityOutline} label="Priority">
              {editable ? (
                <TicketPrioritySelect
                  meta={meta}
                  value={ticket.priority === "none" ? "" : ticket.priority}
                  onChange={(value) =>
                    value !== ticket.priority &&
                    void update({ priority: (value || null) as TTicketPayload["priority"] }, "Priority")
                  }
                  variant="select-ghost-md"
                  className="w-full"
                />
              ) : (
                <TicketPriorityBadge priority={ticket.priority} label={ticket.priority_label} bordered={false} />
              )}
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={MembersOutline} label="Assigned To">
              {editable ? (
                <TicketMemberSelect
                  meta={meta}
                  value={ticket.assignee?.id ?? ""}
                  onChange={(id) => id && id !== ticket.assignee?.id && void update({ assignee_id: id }, "Assignee")}
                  placeholder="Assign someone"
                  variant="select-ghost-md"
                  clearable={false}
                  className="w-full"
                />
              ) : (
                <TicketMemberBadge user={ticket.assignee} />
              )}
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={UserCircleOutline} label="Manager">
              {editable ? (
                <TicketMemberSelect
                  meta={meta}
                  value={ticket.manager?.id ?? ""}
                  onChange={(id) => id && id !== ticket.manager?.id && void update({ manager_id: id }, "Manager")}
                  placeholder="Pick a manager"
                  variant="select-ghost-md"
                  clearable={false}
                  className="w-full"
                />
              ) : (
                <TicketMemberBadge user={ticket.manager} empty="Not set" />
              )}
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={MultiTagOutline} label="Category">
              {editable ? (
                <TicketChoiceSelect
                  options={meta.categories.map((option) => ({ value: option, label: option }))}
                  value={ticket.category ?? ""}
                  onChange={(value) =>
                    value !== (ticket.category ?? "") && void update({ category: value || null }, "Category")
                  }
                  placeholder="Not set"
                  variant="select-ghost-md"
                  className="w-full"
                />
              ) : (
                <PropertyText value={ticket.category} />
              )}
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={UserOutline} label="Creator">
              <TicketMemberBadge user={ticket.created_by} />
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={MultiTagOutline} label="Organization">
              <PropertyText value={ticket.organization_name} />
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={CalendarOutline} label="Created">
              <PropertyText value={renderFormattedDate(ticket.created_at)} />
            </SidebarPropertyListItem>
            <SidebarPropertyListItem icon={HistoryOutline} label="Modified">
              <PropertyText
                value={`${renderFormattedDate(ticket.updated_at)} · ${calculateTimeAgo(ticket.updated_at)}`}
              />
            </SidebarPropertyListItem>
          </div>
          <p className="mt-5 rounded-md bg-layer-1 px-3 py-2 text-caption-md-regular text-tertiary">
            {editable
              ? "Changes here are saved right away and recorded in the activity. Use Edit for the other fields."
              : "Only the assigned user can edit this ticket."}
          </p>
        </div>
      </aside>
    </div>
  );
}

function PropertyText(props: { value?: string | null }) {
  return props.value ? (
    <span className="truncate text-body-xs-regular text-secondary">{props.value}</span>
  ) : (
    <span className="text-body-xs-regular text-placeholder">Not set</span>
  );
}

function SectionHeading(props: {
  icon: React.FC<{ className?: string }>;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  const { icon: HeadingIcon, title, count, action } = props;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <HeadingIcon className="size-4 text-tertiary" />
        <h3 className="text-body-md-medium text-primary">{title}</h3>
        {count !== undefined && <span className="text-body-xs-medium text-tertiary">{count}</span>}
      </div>
      {action}
    </div>
  );
}

/** A bordered block with a heading row, like the cards on the work item page. */
function Card(props: {
  icon: React.FC<{ className?: string }>;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { icon: CardIcon, title, action, children } = props;
  return (
    <section className="rounded-lg border-[0.5px] border-subtle">
      <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-subtle px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CardIcon className="size-4 text-tertiary" />
          <h3 className="text-body-sm-medium text-primary">{title}</h3>
        </div>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** The asset request answers: filled in ones first, the empty ones folded away. */
function AssetRequirementCard(props: { ticket: TTicket }) {
  const { ticket } = props;
  const [showEmpty, setShowEmpty] = useState(false);
  const section = TICKET_SECTIONS.find((s) => s.title === "Asset Requirement");
  if (!section) return null;
  const fields = section.rows.flat().filter((f): f is NonNullable<typeof f> => !!f);
  const filled = fields.filter((field) => textValue(ticket, field.key).trim());
  const empty = fields.filter((field) => !textValue(ticket, field.key).trim());
  const shown = showEmpty ? [...filled, ...empty] : filled;
  const Chevron = showEmpty ? ChevronDownOutline : ChevronRightOutline;

  return (
    <Card
      icon={FileOutline}
      title="Asset Requirement"
      action={
        <span className="text-caption-md-regular text-tertiary">
          {filled.length} of {fields.length} answered
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="text-body-xs-regular text-placeholder">No asset details were given.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          {shown.map((field) => {
            const value = textValue(ticket, field.key);
            return (
              <div key={field.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-caption-md-regular text-tertiary">{field.label}</dt>
                <dd
                  className={cn(
                    "text-body-xs-regular break-words whitespace-pre-wrap",
                    value ? "text-primary" : "text-placeholder"
                  )}
                >
                  {value || "—"}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {empty.length > 0 && (
        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-caption-md-medium text-tertiary hover:text-primary"
          onClick={() => setShowEmpty((open) => !open)}
        >
          <Chevron className="size-3" />
          {showEmpty ? "Hide empty fields" : `Show ${empty.length} empty ${empty.length === 1 ? "field" : "fields"}`}
        </button>
      )}
    </Card>
  );
}

function DocumentsSection(props: { ticket: TTicket; workspaceSlug: string }) {
  const { ticket, workspaceSlug } = props;
  const { data: documents = [], mutate } = useSWR(["TICKET_DOCS", workspaceSlug, ticket.id], () =>
    ticketService.attachments(workspaceSlug, ticket.id)
  );
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await ticketService.uploadAttachment(workspaceSlug, ticket.id, file);
      await mutate();
      setToast({ type: "success", title: "Document added", message: file.name });
    } catch (error) {
      const message = (error as { error?: string })?.error ?? "Upload failed.";
      setToast({ type: "error", title: "Document not added", message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        icon={AttachOutline}
        title="Documents"
        count={documents.length}
        action={
          ticket.can_edit ? (
            <>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <Button
                stretch="auto"
                variant="secondary"
                size="sm"
                label={uploading ? "Uploading…" : "Attach"}
                icon={<Icon icon={AttachOutline} />}
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              />
            </>
          ) : undefined
        }
      />
      {documents.length === 0 ? (
        <p className="text-body-xs-regular text-placeholder">No documents</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {documents.map((doc) => (
            <a
              key={doc.id}
              href={ticketService.attachmentDownloadUrl(workspaceSlug, ticket.id, doc.id)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-md border-[0.5px] border-subtle px-3 py-2 transition-colors hover:bg-layer-transparent-hover"
            >
              <FileOutline className="size-5 shrink-0 text-tertiary" />
              <div className="min-w-0">
                <p className="truncate text-body-xs-medium text-primary">{doc.name}</p>
                <p className="truncate text-caption-sm-regular text-tertiary">
                  {doc.created_by?.name} · {calculateTimeAgo(doc.created_at)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const toHtml = (value: string) =>
  `<p>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`;
const toText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function UserAvatar(props: { user: TTicketUser | null }) {
  const { user } = props;
  return <Avatar size="sm" src={getFileURL(user?.avatar_url ?? "")} alt={user?.name || user?.display_name || "User"} />;
}

function historyText(item: TTicketHistory): React.ReactNode {
  const actor = <span className="font-medium text-primary">{item.actor?.name}</span>;
  if (item.verb === "created" && !item.field) return <>{actor} created the ticket.</>;
  if (item.field === "Document")
    return (
      <>
        {actor} added document <span className="font-medium text-primary">{item.new_value}</span>.
      </>
    );
  return (
    <>
      {actor} updated <span className="font-medium text-primary">{item.field}</span> from{" "}
      <span className="font-medium text-primary">{item.old_value || "empty"}</span> to{" "}
      <span className="font-medium text-primary">{item.new_value || "empty"}</span>.
    </>
  );
}

function CommentBox(props: {
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  onSubmit: (value: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { placeholder, submitLabel, initialValue = "", onSubmit, onCancel } = props;
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-md border-[0.5px] border-subtle bg-surface-1">
      <TextAreaGroup resize="none">
        <TextArea
          size="lg"
          surface="field"
          autoResize
          maxRows={10}
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </TextAreaGroup>
      <div className="flex justify-end gap-2 px-2 py-2">
        {onCancel && <Button stretch="auto" variant="secondary" size="sm" label="Cancel" onClick={onCancel} />}
        <Button
          stretch="auto"
          variant="primary"
          size="sm"
          label={submitLabel}
          loading={busy}
          disabled={!value.trim()}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(value);
            setBusy(false);
            if (ok && !initialValue) setValue("");
          }}
        />
      </div>
    </div>
  );
}

function ActivitySection(props: { ticket: TTicket; workspaceSlug: string }) {
  const { ticket, workspaceSlug } = props;
  const [filter, setFilter] = useState<TActivityFilter>("all");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const { data: comments = [], mutate: mutateComments } = useSWR(["TICKET_COMMENTS", workspaceSlug, ticket.id], () =>
    ticketService.comments(workspaceSlug, ticket.id)
  );
  const { data: history = [] } = useSWR(["TICKET_HISTORY", workspaceSlug, ticket.id, ticket.updated_at], () =>
    ticketService.history(workspaceSlug, ticket.id)
  );

  const post = async (value: string, parentId?: string) => {
    try {
      await ticketService.addComment(workspaceSlug, ticket.id, toHtml(value), parentId);
      await mutateComments();
      return true;
    } catch {
      setToast({ type: "error", title: "Comment not posted", message: "" });
      return false;
    }
  };

  const saveEdit = async (comment: TTicketComment, value: string) => {
    try {
      await ticketService.editComment(workspaceSlug, ticket.id, comment.id, toHtml(value));
      setEditing(null);
      await mutateComments();
      return true;
    } catch {
      setToast({ type: "error", title: "Comment not saved", message: "" });
      return false;
    }
  };

  // Oldest first, like the work item activity feed; replies are rendered under their parent comment.
  const timeline = useMemo(() => {
    const items: (
      | { kind: "update"; at: string; item: TTicketHistory }
      | { kind: "comment"; at: string; item: TTicketComment }
    )[] = [];
    if (filter !== "comments") history.forEach((item) => items.push({ kind: "update", at: item.created_at, item }));
    if (filter !== "updates")
      comments
        .filter((c) => !c.parent_id)
        .forEach((item) => items.push({ kind: "comment", at: item.created_at, item }));
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [comments, history, filter]);
  const replies = (id: string) => comments.filter((c) => c.parent_id === id);

  const renderComment = (comment: TTicketComment, depth = 0): React.ReactNode => (
    <div key={comment.id} className={cn("flex gap-3", depth > 0 && "mt-3")}>
      <div className="shrink-0 pt-0.5">
        <UserAvatar user={comment.actor} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-md border-[0.5px] border-subtle bg-layer-1 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-xs-medium text-primary">{comment.actor?.name}</span>
            <span className="text-caption-sm-regular text-tertiary" title={renderFormattedDate(comment.created_at)}>
              {calculateTimeAgo(comment.created_at)}
              {comment.edited_at ? " · edited" : ""}
            </span>
          </div>
          {editing === comment.id ? (
            <div className="mt-2">
              <CommentBox
                placeholder="Edit comment"
                submitLabel="Save"
                initialValue={toText(comment.comment_html)}
                onSubmit={(value) => saveEdit(comment, value)}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : (
            <div
              className="mt-1 text-body-xs-regular break-words text-secondary"
              // Comment HTML is sanitized server-side (nh3) before it is stored.
              dangerouslySetInnerHTML={{ __html: comment.comment_html }}
            />
          )}
        </div>
        <div className="mt-1 flex gap-3 px-1 text-caption-md-medium text-tertiary">
          <button type="button" className="hover:text-primary" onClick={() => setReplyTo(comment.id)}>
            Reply
          </button>
          {comment.can_edit && editing !== comment.id && (
            <button type="button" className="hover:text-primary" onClick={() => setEditing(comment.id)}>
              Edit
            </button>
          )}
        </div>
        {replyTo === comment.id && (
          <div className="mt-2">
            <CommentBox
              placeholder="Write your reply here..."
              submitLabel="Reply"
              onSubmit={async (value) => {
                const ok = await post(value, comment.id);
                if (ok) setReplyTo(null);
                return ok;
              }}
              onCancel={() => setReplyTo(null)}
            />
          </div>
        )}
        {replies(comment.id).map((reply) => renderComment(reply, depth + 1))}
      </div>
    </div>
  );

  const FILTERS: { key: TActivityFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "updates", label: "Updates" },
    { key: "comments", label: "Comments" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        icon={ActivityOutline}
        title="Activity"
        action={
          <div className="flex items-center gap-0.5 rounded-md bg-layer-1 p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn(
                  "rounded-sm px-2.5 py-1 text-caption-md-medium text-tertiary transition-colors hover:text-primary",
                  filter === item.key && "bg-surface-1 text-primary shadow-raised-100"
                )}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        {timeline.length === 0 && (
          <p className="text-body-xs-regular text-placeholder">
            {filter === "comments" ? "No comments" : filter === "updates" ? "No updates" : "No activity"}
          </p>
        )}
        {timeline.map((entry) =>
          entry.kind === "update" ? (
            <div key={`u-${entry.item.id}`} className="flex items-start gap-3">
              <div className="grid size-7 shrink-0 place-items-center rounded-full border-[0.5px] border-subtle bg-layer-1">
                <HistoryOutline className="size-3.5 text-tertiary" />
              </div>
              <p className="pt-1 text-body-xs-regular text-secondary">
                {historyText(entry.item)}{" "}
                <span className="text-tertiary" title={renderFormattedDate(entry.item.created_at)}>
                  {calculateTimeAgo(entry.item.created_at)}
                </span>
              </p>
            </div>
          ) : (
            renderComment(entry.item)
          )
        )}
      </div>

      <CommentBox placeholder="Add comment" submitLabel="Comment" onSubmit={(value) => post(value)} />
    </div>
  );
}
