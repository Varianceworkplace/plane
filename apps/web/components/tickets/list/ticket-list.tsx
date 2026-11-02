/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import {
  CheckDoneOutline,
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  ChevronUpOutline,
  CloseOutline,
  DownloadOutline,
  EditOutline,
  MessageSupportOutline,
  PriorityOutline,
  RefreshOutline,
  SearchOutline,
  SortAscendingOutline,
  StateOutline,
  UserCircleOutline,
  UserOutline,
} from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { PriorityIcon, StateGroupIcon } from "@plane/blocks/icons";
import type { MemberOption } from "@plane/blocks/property-select";
import { MemberSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import type { TIssuePriorities, TStateGroups } from "@plane/types";
import { calculateTimeAgo, cn, renderFormattedDate } from "@plane/utils";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import { TicketService } from "@/services/ticket.service";
// local
import { ALPHABET } from "../constants";
import {
  TicketChoiceSelect,
  TicketMemberBadge,
  TicketMemberSelect,
  TicketPriorityBadge,
  TicketPrioritySelect,
  TicketStateBadge,
  TicketStatusSelect,
  toMemberOption,
} from "../properties";
import type { TTicket, TTicketListParams, TTicketMeta, TTicketPayload, TTicketStatus } from "../types";

const ticketService = new TicketService();
const PER_PAGE = 20;

type Props = {
  workspaceSlug: string;
  meta: TTicketMeta;
};

type TPriorityOption = { value: string; label: string };

/** The saved views as tiles across the top; the icon says what each one collects. */
const VIEW_ICONS: Record<string, React.FC<{ className?: string }>> = {
  all: MessageSupportOutline,
  open: StateOutline,
  assigned_to_me: UserOutline,
  created_by_me: UserCircleOutline,
  high_priority: PriorityOutline,
  closed: CheckDoneOutline,
};

const SHORT_VIEW_LABELS: Record<string, string> = {
  all: "All tickets",
  open: "Open",
  assigned_to_me: "Assigned to me",
  created_by_me: "Created by me",
  high_priority: "High priority",
  closed: "Closed",
};

const SORT_OPTIONS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-updated_at", label: "Recently updated" },
  { value: "-priority", label: "Priority: high to low" },
  { value: "title", label: "Title: A to Z" },
  { value: "status", label: "Status" },
  { value: "assigned_to", label: "Assignee" },
];

// sortable columns: header key -> order_by key
const COLUMNS = [
  { key: "title", label: "Ticket", className: "min-w-[340px] flex-1" },
  { key: "status", label: "Status", className: "w-44" },
  { key: "priority", label: "Priority", className: "w-36" },
  { key: "assigned_to", label: "Assigned to", className: "w-48" },
  { key: "updated_at", label: "Updated", className: "w-32" },
] as const;

const summaryKey = (workspaceSlug: string) => ["TICKET_SUMMARY", workspaceSlug];

/** Ticket list: saved views with counts, filter pills, a sortable table with inline status / priority, bulk actions. */
export function TicketList(props: Props) {
  const { workspaceSlug, meta } = props;
  const router = useAppRouter();
  // view and filters
  const [view, setView] = useState("all");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [stateIds, setStateIds] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [alphabet, setAlphabet] = useState("");
  const [showAlphabet, setShowAlphabet] = useState(false);
  const [orderBy, setOrderBy] = useState("-created_at");
  const [page, setPage] = useState(1);
  // selection and dialogs
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<"edit" | "comment" | null>(null);

  // search as you type, without a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [keywordInput]);
  // any change to what's shown starts again at page 1
  useEffect(() => setPage(1), [view, keyword, stateIds, priorities, assigneeIds, alphabet, orderBy]);

  const params: TTicketListParams = {
    filter: view,
    ...(keyword ? { search: keyword } : {}),
    ...(stateIds.length ? { state_ids: stateIds.join(",") } : {}),
    ...(priorities.length ? { priorities: priorities.join(",") } : {}),
    ...(assigneeIds.length ? { assignee_ids: assigneeIds.join(",") } : {}),
    ...(alphabet ? { alphabet } : {}),
    order_by: orderBy,
    page,
    per_page: PER_PAGE,
  };
  const { data, isLoading, mutate } = useSWR(["TICKETS", workspaceSlug, JSON.stringify(params)], () =>
    ticketService.list(workspaceSlug, params)
  );
  const { data: summary, mutate: mutateSummary } = useSWR(summaryKey(workspaceSlug), () =>
    ticketService.summary(workspaceSlug)
  );

  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const start = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const end = Math.min(page * PER_PAGE, total);
  const allSelected = results.length > 0 && results.every((t) => selected.includes(t.id));
  const filterCount = stateIds.length + priorities.length + assigneeIds.length + (alphabet ? 1 : 0) + (keyword ? 1 : 0);

  const refresh = () => Promise.all([mutate(), mutateSummary()]);

  const clearFilters = () => {
    setKeywordInput("");
    setKeyword("");
    setStateIds([]);
    setPriorities([]);
    setAssigneeIds([]);
    setAlphabet("");
  };

  // first click sorts descending, the next ascending
  const toggleSort = (key: string) => setOrderBy((previous) => (previous === `-${key}` ? key : `-${key}`));

  const exportTickets = () => {
    const query: Record<string, string> = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && key !== "page" && key !== "per_page") query[key] = String(value);
    });
    if (selected.length) query.ids = selected.join(",");
    window.open(ticketService.exportUrl(workspaceSlug, query), "_blank");
  };

  /** Status / priority changed right in the row (assignees only). */
  const updateInline = async (ticket: TTicket, payload: TTicketPayload) => {
    try {
      await ticketService.update(workspaceSlug, ticket.id, payload);
      await refresh();
    } catch (error) {
      const message = (error as { error?: string })?.error ?? "Please try again.";
      setToast({ type: "error", title: `${ticket.ticket_number} not updated`, message });
    }
  };

  // ------------------------------------------------------------ filter pill options
  const statusOptions = meta.statuses;
  const priorityOptions = useMemo<TPriorityOption[]>(
    () => meta.priorities.filter((p) => p.value !== "none").map((p) => ({ value: p.value, label: p.label })),
    [meta.priorities]
  );
  const memberOptions = useMemo<MemberOption[]>(() => meta.members.map(toMemberOption), [meta.members]);
  const getMembers = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const matches = memberOptions.filter(
        (m) => !query || `${m.name ?? ""} ${m.display_name}`.toLowerCase().includes(query)
      );
      return { results: matches, next_page_results: false };
    },
    [memberOptions]
  );

  return (
    <div className="flex h-full flex-col">
      {/* saved views with their counts */}
      <div className="flex gap-2 overflow-x-auto border-b-[0.5px] border-subtle px-page-x py-3">
        {meta.filters.map((item) => {
          const ViewIcon = VIEW_ICONS[item.key] ?? MessageSupportOutline;
          const isActive = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setView(item.key)}
              className={cn(
                "flex min-w-36 shrink-0 flex-col gap-1.5 rounded-lg border-[0.5px] px-3 py-2.5 text-left transition-colors",
                isActive
                  ? "border-accent-strong bg-accent-primary/5"
                  : "border-subtle bg-surface-1 hover:border-strong hover:bg-layer-transparent-hover"
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1.5 text-caption-md-medium",
                  isActive ? "text-accent-primary" : "text-tertiary"
                )}
              >
                <ViewIcon className="size-3.5" />
                {SHORT_VIEW_LABELS[item.key] ?? item.label}
              </span>
              <span className="text-h5-semibold text-primary tabular-nums">{summary?.views[item.key] ?? "–"}</span>
            </button>
          );
        })}
      </div>

      {/* search, filter pills, sort */}
      <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-subtle px-page-x py-2">
        <div className="w-64">
          <InputGroup size="md">
            <SearchOutline className="ml-2 size-3.5 shrink-0 text-placeholder" />
            <Input
              size="md"
              aria-label="Search tickets"
              placeholder="Search title or ticket number"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
            />
          </InputGroup>
        </div>
        <Select<TTicketStatus>
          multiple
          getValues={() => statusOptions}
          value={statusOptions.filter((s) => stateIds.includes(s.id))}
          onChange={setStateIds}
          getOptionValue={(s) => s.id}
          getOptionLabel={(s) => s.name}
          getOptionIcon={(s) => <StateGroupIcon stateGroup={s.group as TStateGroups} color={s.color} size="sm" />}
          showSearch={false}
          pinSelected={false}
        >
          <Select.Trigger<TTicketStatus>
            variant="pill-md"
            prependIcon={() => <StateOutline aria-hidden="true" className="size-3 text-secondary" />}
          >
            {(items) =>
              items.length === 0 ? "Status" : items.length === 1 ? items[0].name : `${items.length} statuses`
            }
          </Select.Trigger>
        </Select>
        <Select<TPriorityOption>
          multiple
          getValues={() => priorityOptions}
          value={priorityOptions.filter((p) => priorities.includes(p.value))}
          onChange={setPriorities}
          getOptionValue={(p) => p.value}
          getOptionLabel={(p) => p.label}
          getOptionIcon={(p) => <PriorityIcon priority={p.value as TIssuePriorities} className="size-3.5" />}
          showSearch={false}
          pinSelected={false}
        >
          <Select.Trigger<TPriorityOption>
            variant="pill-md"
            prependIcon={() => <PriorityOutline aria-hidden="true" className="size-3 text-secondary" />}
          >
            {(items) =>
              items.length === 0 ? "Priority" : items.length === 1 ? items[0].label : `${items.length} priorities`
            }
          </Select.Trigger>
        </Select>
        <MemberSelect
          multiple
          variant="pill-md"
          getValues={getMembers}
          value={memberOptions.filter((m) => assigneeIds.includes(m.id))}
          onChange={setAssigneeIds}
          placeholder="Assignee"
          searchPlaceholder="Search people"
          showLabel
        />
        <Button
          stretch="auto"
          variant={showAlphabet || alphabet ? "secondary" : "tertiary"}
          size="md"
          label={alphabet ? `Starts with ${alphabet}` : "A–Z"}
          onClick={() => setShowAlphabet((open) => !open)}
        />
        {filterCount > 0 && (
          <Button
            stretch="auto"
            variant="ghost"
            size="md"
            label="Clear filters"
            icon={<Icon icon={CloseOutline} />}
            onClick={clearFilters}
          />
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <TicketChoiceSelect
            options={SORT_OPTIONS}
            value={orderBy}
            onChange={(value) => setOrderBy(value || "-created_at")}
            placeholder="Sort"
            allowClear={false}
            icon={<SortAscendingOutline className="size-3.5 text-tertiary" />}
          />
          <Tooltip label="Export to CSV">
            <IconButton
              variant="ghost"
              size="md"
              icon={<Icon icon={DownloadOutline} />}
              aria-label="Export to CSV"
              onClick={exportTickets}
            />
          </Tooltip>
          <Tooltip label="Refresh">
            <IconButton
              variant="ghost"
              size="md"
              icon={<Icon icon={RefreshOutline} />}
              aria-label="Refresh"
              onClick={() => void refresh()}
            />
          </Tooltip>
        </div>
      </div>

      {/* A-Z quick filter (title starts with), on demand */}
      {(showAlphabet || alphabet) && (
        <div className="flex items-center gap-0.5 overflow-x-auto border-b-[0.5px] border-subtle px-page-x py-1.5">
          {ALPHABET.map((letter) => (
            <button
              key={letter}
              type="button"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-sm text-caption-md-medium text-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-primary",
                alphabet === letter && "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
              )}
              onClick={() => setAlphabet((previous) => (previous === letter ? "" : letter))}
            >
              {letter}
            </button>
          ))}
        </div>
      )}

      {/* table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[960px]">
          <div className="sticky top-0 z-[1] flex items-center border-b-[0.5px] border-subtle bg-layer-1 text-caption-md-medium text-tertiary">
            <div className="flex w-10 shrink-0 justify-center py-2.5 pl-2">
              <Checkbox
                aria-label="Select all on this page"
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected((previous) =>
                    checked
                      ? Array.from(new Set([...previous, ...results.map((t) => t.id)]))
                      : previous.filter((id) => !results.some((t) => t.id === id))
                  )
                }
              />
            </div>
            {COLUMNS.map((column) => {
              const sortIcon =
                orderBy === column.key ? ChevronUpOutline : orderBy === `-${column.key}` ? ChevronDownOutline : null;
              return (
                <button
                  key={column.key}
                  type="button"
                  className={cn(
                    "flex shrink-0 items-center gap-1 px-3 py-2.5 text-left hover:text-primary",
                    column.className
                  )}
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                  {sortIcon && (
                    <span className="text-accent-primary">
                      <Icon icon={sortIcon} />
                    </span>
                  )}
                </button>
              );
            })}
            <div className="w-12 shrink-0" />
          </div>

          {isLoading && !data ? (
            Array.from({ length: 6 }).map((_, index) => (
              // oxlint-disable-next-line react/no-array-index-key
              <div key={index} className="flex items-center gap-3 border-b-[0.5px] border-subtle px-page-x py-3">
                <div className="h-4 w-14 animate-pulse rounded-sm bg-layer-1" />
                <div className="h-4 flex-1 animate-pulse rounded-sm bg-layer-1" />
                <div className="h-4 w-24 animate-pulse rounded-sm bg-layer-1" />
              </div>
            ))
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center px-page-x py-16">
              <EmptyStateCompact
                title={filterCount ? "No tickets match these filters" : "No tickets here yet"}
                description={
                  filterCount
                    ? "Try another search, or clear the filters."
                    : "Raise a ticket for an asset, access or tool request and track it to resolution."
                }
                assetKey={filterCount ? "search-compact" : "work-item"}
                assetClassName="size-20"
                align="center"
                actions={
                  filterCount
                    ? [{ label: "Clear filters", onClick: clearFilters }]
                    : [{ label: "New ticket", onClick: () => router.push(`/${workspaceSlug}/tickets/new`) }]
                }
              />
            </div>
          ) : (
            results.map((ticket) => {
              const isSelected = selected.includes(ticket.id);
              const subtitle = [ticket.organization_name, ticket.category].filter(Boolean).join(" · ");
              return (
                <div
                  key={ticket.id}
                  className={cn(
                    "group/ticket flex min-h-14 items-center border-b-[0.5px] border-subtle text-body-xs-regular transition-colors hover:bg-layer-transparent-hover",
                    isSelected && "bg-accent-primary/5 hover:bg-accent-primary/10"
                  )}
                >
                  <div className="flex w-10 shrink-0 justify-center pl-2">
                    <span className={cn("opacity-0 group-hover/ticket:opacity-100", isSelected && "opacity-100")}>
                      <Checkbox
                        aria-label={`Select ${ticket.ticket_number}`}
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          setSelected((previous) =>
                            checked ? [...previous, ticket.id] : previous.filter((id) => id !== ticket.id)
                          )
                        }
                      />
                    </span>
                  </div>
                  <Link
                    href={`/${workspaceSlug}/tickets/${ticket.id}`}
                    className={cn("flex min-w-0 shrink-0 items-center gap-3 px-3 py-2", COLUMNS[0].className)}
                  >
                    <span className="shrink-0 rounded-sm bg-layer-1 px-1.5 py-0.5 text-caption-md-medium text-tertiary tabular-nums">
                      {ticket.ticket_number}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body-xs-medium text-primary group-hover/ticket:underline">
                        {ticket.name}
                      </span>
                      {subtitle && <span className="truncate text-caption-md-regular text-tertiary">{subtitle}</span>}
                    </span>
                  </Link>
                  <div className={cn("shrink-0 px-3", COLUMNS[1].className)}>
                    {ticket.can_edit ? (
                      <TicketStatusSelect
                        meta={meta}
                        value={ticket.state?.id ?? ""}
                        onChange={(id) => id !== ticket.state?.id && void updateInline(ticket, { state_id: id })}
                      />
                    ) : (
                      <TicketStateBadge state={ticket.state} />
                    )}
                  </div>
                  <div className={cn("shrink-0 px-3", COLUMNS[2].className)}>
                    {ticket.can_edit ? (
                      <TicketPrioritySelect
                        meta={meta}
                        value={ticket.priority === "none" ? "" : ticket.priority}
                        onChange={(value) =>
                          value !== ticket.priority &&
                          void updateInline(ticket, { priority: (value || null) as TTicketPayload["priority"] })
                        }
                      />
                    ) : (
                      <TicketPriorityBadge priority={ticket.priority} label={ticket.priority_label} />
                    )}
                  </div>
                  <div className={cn("shrink-0 truncate px-3", COLUMNS[3].className)}>
                    <TicketMemberBadge user={ticket.assignee} />
                  </div>
                  <div
                    className={cn("shrink-0 px-3 whitespace-nowrap text-tertiary", COLUMNS[4].className)}
                    title={renderFormattedDate(ticket.updated_at) ?? undefined}
                  >
                    {calculateTimeAgo(ticket.updated_at)}
                  </div>
                  <div className="flex w-12 shrink-0 justify-end pr-3 opacity-0 group-hover/ticket:opacity-100">
                    {ticket.can_edit && (
                      <Tooltip label="Edit all fields">
                        <Link href={`/${workspaceSlug}/tickets/${ticket.id}/edit`} aria-label="Edit">
                          <IconButton variant="ghost" size="sm" icon={<Icon icon={EditOutline} />} aria-label="Edit" />
                        </Link>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* bulk actions while something is selected, else the pager */}
      <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-subtle px-page-x py-2">
        {selected.length > 0 ? (
          <>
            <span className="text-caption-md-medium text-accent-primary">{selected.length} selected</span>
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label="Edit"
              icon={<Icon icon={EditOutline} />}
              onClick={() => setModal("edit")}
            />
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label="Add comment"
              icon={<Icon icon={MessageSupportOutline} />}
              onClick={() => setModal("comment")}
            />
            <Button
              stretch="auto"
              variant="secondary"
              size="sm"
              label="Export selected"
              icon={<Icon icon={DownloadOutline} />}
              onClick={exportTickets}
            />
            <Button stretch="auto" variant="ghost" size="sm" label="Clear selection" onClick={() => setSelected([])} />
          </>
        ) : (
          <span className="text-caption-md-regular text-tertiary">
            {total ? `Showing ${start}–${end} of ${total}` : "No tickets"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className="px-1 text-caption-md-regular text-tertiary">
            Page {page} of {pageCount}
          </span>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronLeftOutline} />}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={ChevronRightOutline} />}
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          />
        </div>
      </div>

      <MassEditDialog
        open={modal === "edit"}
        workspaceSlug={workspaceSlug}
        meta={meta}
        ticketIds={selected}
        onClose={(changed) => {
          setModal(null);
          if (changed) {
            setSelected([]);
            void refresh();
          }
        }}
      />
      <BulkCommentDialog
        open={modal === "comment"}
        workspaceSlug={workspaceSlug}
        ticketIds={selected}
        onClose={(added) => {
          setModal(null);
          if (added) setSelected([]);
        }}
      />
    </div>
  );
}

const plain = (values: string[]) => values.map((v) => ({ value: v, label: v }));
const row = (label: string, control: React.ReactNode) => (
  <div className="flex items-center gap-3">
    <span className="w-48 shrink-0 text-body-xs-regular text-tertiary">{label}</span>
    {control}
  </div>
);

function MassEditDialog(props: {
  open: boolean;
  workspaceSlug: string;
  meta: TTicketMeta;
  ticketIds: string[];
  onClose: (changed: boolean) => void;
}) {
  const { open, workspaceSlug, meta, ticketIds, onClose } = props;
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setChanges({});
  }, [open]);

  const set = (key: string, value: string) =>
    setChanges((prev) => {
      const next = { ...prev, [key]: value };
      if (!value) delete next[key];
      return next;
    });

  const save = async () => {
    if (!Object.keys(changes).length) return onClose(false);
    setSaving(true);
    try {
      const result = await ticketService.bulkUpdate(workspaceSlug, ticketIds, changes as TTicketPayload);
      setToast({
        type: result.skipped.length ? "warning" : "success",
        title: `${result.updated.length} ticket(s) updated`,
        message: result.skipped.length
          ? `${result.skipped.length} ticket(s) skipped: only the assigned user can edit a ticket.`
          : "",
      });
      onClose(true);
    } catch {
      setToast({ type: "error", title: "Update failed", message: "Please check the values and try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>Mass edit {ticketIds.length} ticket(s)</DialogTitle>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-2.5 px-5 py-4">
            {row(
              "Status",
              <TicketStatusSelect meta={meta} value={changes.state_id ?? ""} onChange={(v) => set("state_id", v)} />
            )}
            {row(
              "Priority",
              <TicketPrioritySelect meta={meta} value={changes.priority ?? ""} onChange={(v) => set("priority", v)} />
            )}
            {row(
              "Assigned To",
              <TicketMemberSelect
                meta={meta}
                value={changes.assignee_id ?? ""}
                onChange={(v) => set("assignee_id", v)}
                placeholder="No change"
              />
            )}
            {row(
              "Manager",
              <TicketMemberSelect
                meta={meta}
                value={changes.manager_id ?? ""}
                onChange={(v) => set("manager_id", v)}
                placeholder="No change"
              />
            )}
            {row(
              "Category",
              <TicketChoiceSelect
                options={plain(meta.categories)}
                value={changes.category ?? ""}
                onChange={(v) => set("category", v)}
                placeholder="No change"
              />
            )}
            {row(
              "Tool Category",
              <TicketChoiceSelect
                options={plain(meta.tool_categories)}
                value={changes.tool_category ?? ""}
                onChange={(v) => set("tool_category", v)}
                placeholder="No change"
              />
            )}
            {row(
              "Have you tested the free trial/demo?",
              <TicketChoiceSelect
                options={plain(meta.trial_tested)}
                value={changes.trial_tested ?? ""}
                onChange={(v) => set("trial_tested", v)}
                placeholder="No change"
              />
            )}
            <p className="pt-1 text-caption-md-regular text-tertiary">Only tickets assigned to you are updated.</p>
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button stretch="auto" variant="primary" size="md" label="Save" loading={saving} onClick={save} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function BulkCommentDialog(props: {
  open: boolean;
  workspaceSlug: string;
  ticketIds: string[];
  onClose: (added: boolean) => void;
}) {
  const { open, workspaceSlug, ticketIds, onClose } = props;
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  const save = async () => {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      const html = `<p>${comment.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`;
      const result = await ticketService.bulkComment(workspaceSlug, ticketIds, html);
      setToast({ type: "success", title: `Comment added to ${result.added} ticket(s)`, message: "" });
      onClose(true);
    } catch {
      setToast({ type: "error", title: "Comment not added", message: "" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>Add comment to {ticketIds.length} ticket(s)</DialogTitle>
        </div>
        <DialogMain>
          <div className="px-5 py-4">
            <TextAreaGroup resize="none">
              <TextArea
                size="lg"
                surface="field"
                autoResize
                maxRows={10}
                aria-label="Comment"
                placeholder="Write your comment here..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </TextAreaGroup>
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="Save"
            loading={saving}
            disabled={!comment.trim()}
            onClick={save}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
