/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Checkbox } from "@makeplane/propel/components/checkbox";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { SearchOutline } from "@makeplane/propel/icons";
import { StateGroupIcon } from "@plane/blocks/icons";
import { setToast } from "@plane/blocks/toast";
import type { TStateGroups } from "@plane/types";
// local imports
import { milestoneService } from "../helpers";

type Props = {
  open: boolean;
  workspaceSlug: string;
  projectId: string;
  milestoneId: string;
  onClose: (linked: boolean) => void;
};

/** Lists this project's work items that aren't in a milestone yet (drafts, archived and intake excluded). */
export function LinkWorkItemsModal(props: Props) {
  const { open, workspaceSlug, projectId, milestoneId, onClose } = props;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setQuery("");
    setSelected([]);
  }, [open]);

  // debounce the search box
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: items, isLoading } = useSWR(
    open ? ["MILESTONE_AVAILABLE_WORK_ITEMS", milestoneId, query] : null,
    () => milestoneService.availableWorkItems(workspaceSlug, projectId, milestoneId, query),
    { revalidateOnFocus: false }
  );

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));

  const save = async () => {
    if (!selected.length || saving) return;
    setSaving(true);
    try {
      await milestoneService.linkWorkItems(workspaceSlug, projectId, milestoneId, { add: selected });
      setToast({ type: "success", title: `${selected.length} work item(s) added`, message: "" });
      onClose(true);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Work items not added", message: data.error ?? "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>Link work items</DialogTitle>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-3 px-5 py-4">
            <InputGroup size="md">
              <span className="flex items-center pl-2 text-tertiary">
                <SearchOutline className="size-3.5" />
              </span>
              <Input
                size="md"
                aria-label="Search work items"
                placeholder="Search by name or number"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <div className="max-h-80 overflow-y-auto rounded-md border-[0.5px] border-subtle">
              {isLoading && !items ? (
                <p className="px-3 py-6 text-center text-body-xs-regular text-tertiary">Loading…</p>
              ) : !items?.length ? (
                <p className="px-3 py-6 text-center text-body-xs-regular text-tertiary">
                  {query ? "No work items match your search." : "Every work item is already in a milestone."}
                </p>
              ) : (
                items.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-3 border-b-[0.5px] border-subtle px-3 py-2 last:border-b-0 hover:bg-layer-transparent-hover"
                  >
                    <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => toggle(item.id)} />
                    {item.state && (
                      <StateGroupIcon
                        stateGroup={item.state.group as TStateGroups}
                        color={item.state.color}
                        size="sm"
                      />
                    )}
                    <span className="flex-shrink-0 text-caption-md-regular text-tertiary">
                      {item.project_identifier}-{item.sequence_id}
                    </span>
                    <span className="truncate text-body-xs-regular text-primary">{item.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={selected.length ? `Add selected work items (${selected.length})` : "Add selected work items"}
            disabled={!selected.length}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
