/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import {
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  ChevronUpOutline,
  CloseOutline,
  EditOutline,
  ExportOutline,
  FilterOutline,
  HistoryOutline,
  MembersOutline,
  MessageSupportOutline,
  MultiTagOutline,
  PriorityOutline,
  SearchOutline,
  StateOutline,
  TextOutline,
} from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// services
import { TicketService } from "@/services/ticket.service";
// local
import { ALPHABET, EMPTY_VALUE } from "../constants";
import {
  TicketChoiceSelect,
  TicketMemberBadge,
  TicketMemberSelect,
  TicketPriorityBadge,
  TicketPrioritySelect,
  TicketStateBadge,
  TicketStatusSelect,
} from "../properties";
import type { TTicketListParams, TTicketMeta, TTicketPayload } from "../types";

const ticketService = new TicketService();
const PER_PAGE = 20;

type Props = {
  workspaceSlug: string;
  meta: TTicketMeta;
};

type TColumnSearch = Record<string, string>;

const COLUMNS = [
  { key: "title", label: "Title", icon: TextOutline, className: "min-w-[320px] flex-1" },
  { key: "organization_name", label: "Organization Name", icon: MultiTagOutline, className: "w-48" },
  { key: "status", label: "Status", icon: StateOutline, className: "w-44" },
  { key: "priority", label: "Priority", icon: PriorityOutline, className: "w-32" },
  { key: "assigned_to", label: "Assigned To", icon: MembersOutline, className: "w-48" },
] as const;

export function TicketList(props: Props) {
  const { workspaceSlug, meta } = props;
  const [filter, setFilter] = useState("all");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [showColumnSearch, setShowColumnSearch] = useState(false);
  const [columnInputs, setColumnInputs] = useState<TColumnSearch>({});
  const [columnSearch, setColumnSearch] = useState<TColumnSearch>({});
  const [alphabet, setAlphabet] = useState<string>("");
  const [orderBy, setOrderBy] = useState("-created_at");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<"edit" | "comment" | null>(null);

  useEffect(() => setPage(1), [keyword]);

  const params: TTicketListParams = {
    filter,
    ...columnSearch,
    ...(keyword ? { search: keyword } : {}),
    ...(alphabet ? { alphabet } : {}),
    order_by: orderBy,
    page,
    per_page: PER_PAGE,
  };
  const { data, isLoading, mutate } = useSWR(["TICKETS", workspaceSlug, JSON.stringify(params)], () =>
    ticketService.list(workspaceSlug, params)
  );

  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const end = Math.min(page * PER_PAGE, total);
  const allSelected = results.length > 0 && results.every((t) => selected.includes(t.id));
  const activeColumnFilters = Object.keys(columnSearch).length;
  const filterLabel = meta.filters.find((f) => f.key === filter)?.label ?? "All Tickets";

  const toggleSort = (key: string) => setOrderBy((prev) => (prev === key ? `-${key}` : key));

  const runColumnSearch = () => {
    setPage(1);
    setColumnSearch(Object.fromEntries(Object.entries(columnInputs).filter(([, v]) => v.trim())));
  };
  const clearColumnSearch = () => {
    setColumnInputs({});
    setColumnSearch({});
    setPage(1);
  };

  const exportTickets = () => {
    const query: Record<string, string> = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && key !== "page" && key !== "per_page") query[key] = String(value);
    });
    if (selected.length) query.ids = selected.join(",");
    window.open(ticketService.exportUrl(workspaceSlug, query), "_blank");
  };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-subtle px-page-x py-2">
        <div className="flex flex-wrap items-center gap-2">
          <TicketChoiceSelect
            options={meta.filters.map((f) => ({ value: f.key, label: f.label }))}
            value={filter}
            onChange={(value) => {
              setFilter(value || "all");
              setPage(1);
            }}
            placeholder="All Tickets"
            allowClear={false}
            icon={<FilterOutline className="size-3.5 text-tertiary" />}
          />
          <div className="w-64">
            <InputGroup size="md">
              <SearchOutline className="ml-2 size-3.5 shrink-0 text-placeholder" />
              <Input
                size="md"
                aria-label="Search tickets"
                placeholder="Search title or ticket number"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(keywordInput.trim())}
              />
            </InputGroup>
          </div>
          <Button
            stretch="auto"
            variant={showColumnSearch || activeColumnFilters ? "secondary" : "tertiary"}
            size="md"
            label={activeColumnFilters ? `Column search (${activeColumnFilters})` : "Column search"}
            icon={<Icon icon={FilterOutline} />}
            onClick={() => setShowColumnSearch((v) => !v)}
          />
        </div>

        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="text-caption-md-medium text-accent-primary">{selected.length} selected</span>
          )}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  stretch="auto"
                  variant="secondary"
                  size="md"
                  label="Actions"
                  icon={<Icon icon={ChevronDownOutline} />}
                  iconPosition="end"
                />
              }
            />
            <MenuContent side="bottom" align="end">
              <MenuItem
                label="Edit"
                icon={<Icon icon={EditOutline} />}
                disabled={selected.length === 0}
                onClick={() => setModal("edit")}
              />
              <MenuItem
                label="Add Comment"
                icon={<Icon icon={MessageSupportOutline} />}
                disabled={selected.length === 0}
                onClick={() => setModal("comment")}
              />
              <MenuItem label="Export" icon={<Icon icon={ExportOutline} />} onClick={exportTickets} />
            </MenuContent>
          </Menu>
          <span className="pl-1 text-caption-md-regular whitespace-nowrap text-tertiary">
            {start} to {end}
            {total > 0 ? ` of ${total}` : ""}
          </span>
          <Tooltip label="Refresh">
            <IconButton
              variant="ghost"
              size="md"
              icon={<Icon icon={HistoryOutline} />}
              aria-label="Refresh"
              onClick={() => mutate()}
            />
          </Tooltip>
          <IconButton
            variant="ghost"
            size="md"
            icon={<Icon icon={ChevronLeftOutline} />}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          />
          <IconButton
            variant="ghost"
            size="md"
            icon={<Icon icon={ChevronRightOutline} />}
            aria-label="Next page"
            disabled={end >= total}
            onClick={() => setPage((p) => p + 1)}
          />
        </div>
      </div>

      {/* A-Z quick filter */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b-[0.5px] border-subtle px-page-x py-1.5">
        {ALPHABET.map((letter) => (
          <button
            key={letter}
            type="button"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-sm text-caption-md-medium text-tertiary transition-colors hover:bg-layer-transparent-hover hover:text-primary",
              alphabet === letter && "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
            )}
            onClick={() => {
              setAlphabet((prev) => (prev === letter ? "" : letter));
              setPage(1);
            }}
          >
            {letter}
          </button>
        ))}
        {alphabet && (
          <button
            type="button"
            className="ml-1 flex items-center gap-1 rounded-sm px-1.5 text-caption-md-regular text-tertiary hover:text-primary"
            onClick={() => setAlphabet("")}
          >
            <CloseOutline className="size-3" /> Clear
          </button>
        )}
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[1100px]">
          <div className="sticky top-0 z-[1] flex items-center border-b-[0.5px] border-subtle bg-layer-1 text-body-xs-medium text-tertiary">
            <div className="flex w-10 shrink-0 justify-center py-2.5">
              <Checkbox
                aria-label="Select all"
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked ? Array.from(new Set([...selected, ...results.map((t) => t.id)])) : [])
                }
              />
            </div>
            {COLUMNS.map((column) => {
              const ColumnIcon = column.icon;
              const sortIcon =
                orderBy === column.key ? ChevronUpOutline : orderBy === `-${column.key}` ? ChevronDownOutline : null;
              return (
                <button
                  key={column.key}
                  type="button"
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-left hover:text-primary",
                    column.className
                  )}
                  onClick={() => toggleSort(column.key)}
                >
                  <ColumnIcon className="size-3.5" />
                  {column.label}
                  {sortIcon && (
                    <span className="text-accent-primary">
                      <Icon icon={sortIcon} />
                    </span>
                  )}
                </button>
              );
            })}
            <div className="w-20 shrink-0" />
          </div>

          {showColumnSearch && (
            <div className="flex items-center border-b-[0.5px] border-subtle bg-layer-1/50 py-1.5">
              <div className="w-10 shrink-0" />
              {COLUMNS.map((column) => (
                <div key={column.key} className={cn("shrink-0 px-2", column.className)}>
                  <InputGroup size="md">
                    <Input
                      size="md"
                      aria-label={`Search ${column.label}`}
                      placeholder={column.label}
                      value={columnInputs[column.key] ?? ""}
                      onChange={(e) => setColumnInputs((prev) => ({ ...prev, [column.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && runColumnSearch()}
                    />
                  </InputGroup>
                </div>
              ))}
              <div className="flex w-20 shrink-0 items-center gap-1 pr-2">
                <Button stretch="auto" variant="primary" size="sm" label="Search" onClick={runColumnSearch} />
                {activeColumnFilters > 0 && (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={CloseOutline} />}
                    aria-label="Clear column search"
                    onClick={clearColumnSearch}
                  />
                )}
              </div>
            </div>
          )}

          {/* group header, as in the work item list */}
          <div className="flex items-center gap-2 border-b-[0.5px] border-subtle px-page-x py-2.5">
            <MessageSupportOutline className="size-4 text-tertiary" />
            <span className="text-body-sm-medium text-primary">{filterLabel}</span>
            <span className="text-body-xs-medium text-tertiary">{total}</span>
          </div>

          {isLoading && <div className="px-page-x py-6 text-body-xs-regular text-placeholder">Loading tickets…</div>}

          {!isLoading && results.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <MessageSupportOutline className="size-10 text-placeholder" />
              <p className="text-body-sm-medium text-secondary">No Tickets found.</p>
              <Link href={`/${workspaceSlug}/tickets/new`}>
                <Button stretch="auto" variant="primary" size="md" label="Add Ticket" />
              </Link>
            </div>
          )}

          {results.map((ticket) => {
            const isSelected = selected.includes(ticket.id);
            return (
              <div
                key={ticket.id}
                className={cn(
                  "group/ticket flex min-h-11 items-center border-b-[0.5px] border-subtle text-body-xs-regular transition-colors hover:bg-layer-transparent-hover",
                  isSelected && "bg-accent-primary/5 hover:bg-accent-primary/10"
                )}
              >
                <div className="flex w-10 shrink-0 justify-center">
                  <span className={cn("opacity-0 group-hover/ticket:opacity-100", isSelected && "opacity-100")}>
                    <Checkbox
                      aria-label={`Select ${ticket.ticket_number}`}
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => (checked ? [...prev, ticket.id] : prev.filter((id) => id !== ticket.id)))
                      }
                    />
                  </span>
                </div>
                <Link
                  href={`/${workspaceSlug}/tickets/${ticket.id}`}
                  className={cn("flex min-w-0 shrink-0 items-center gap-3 px-3 py-2.5", COLUMNS[0].className)}
                >
                  <span className="w-14 shrink-0 text-caption-md-medium text-tertiary">{ticket.ticket_number}</span>
                  <span className="truncate text-body-xs-medium text-primary">{ticket.name}</span>
                </Link>
                <div className={cn("shrink-0 truncate px-3 text-secondary", COLUMNS[1].className)}>
                  {ticket.organization_name || <span className="text-placeholder">{EMPTY_VALUE}</span>}
                </div>
                <div className={cn("shrink-0 px-3", COLUMNS[2].className)}>
                  <TicketStateBadge state={ticket.state} />
                </div>
                <div className={cn("shrink-0 px-3", COLUMNS[3].className)}>
                  <TicketPriorityBadge priority={ticket.priority} label={ticket.priority_label} />
                </div>
                <div className={cn("shrink-0 px-3", COLUMNS[4].className)}>
                  <TicketMemberBadge user={ticket.assignee} />
                </div>
                <div className="flex w-20 shrink-0 items-center justify-end gap-0.5 pr-3 opacity-0 group-hover/ticket:opacity-100">
                  {ticket.can_edit && (
                    <Tooltip label="Edit">
                      <Link href={`/${workspaceSlug}/tickets/${ticket.id}/edit`} aria-label="Edit">
                        <IconButton variant="ghost" size="sm" icon={<Icon icon={EditOutline} />} aria-label="Edit" />
                      </Link>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
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
            mutate();
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

  const plain = (values: string[]) => values.map((v) => ({ value: v, label: v }));
  const row = (label: string, control: React.ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="w-48 shrink-0 text-body-xs-regular text-tertiary">{label}</span>
      {control}
    </div>
  );

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
