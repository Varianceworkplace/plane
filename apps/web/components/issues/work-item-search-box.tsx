/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
// plane imports
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { CloseCircleOutline, SearchOutline } from "@makeplane/propel/icons";

type TWorkItemSearchBoxProps = {
  /** the search the list shows now (kept in its filter store) */
  value: string;
  /** called with the trimmed text once typing pauses; "" shows the whole list again */
  onSearch: (query: string) => void;
};

/**
 * The search box of a work item list (Projects › Project Tasks, a project's task list): any field of a task, such as
 * its name, task number (ACMEWEB-6), status, priority, a date, a person or a label (plane.utils.work_item_search).
 * What's typed shows at once; the list is searched once typing pauses (300 ms). × or Esc clears it.
 */
export function WorkItemSearchBox(props: TWorkItemSearchBoxProps) {
  const { value, onSearch } = props;
  const [input, setInput] = useState(value);

  // cleared from elsewhere (the empty list's Clear search): empty the box too
  useEffect(() => {
    if (value === "") setInput((current) => (current.trim() === "" ? current : ""));
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => onSearch(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input, onSearch]);

  return (
    <div className="w-36 2xl:w-60">
      <InputGroup size="md">
        <SearchOutline className="ml-2 size-3.5 shrink-0 text-placeholder" />
        <Input
          size="md"
          aria-label="Search project tasks"
          placeholder="Search tasks"
          title="Search any field: name, task number, status, priority, date, person, label, module, milestone…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setInput("");
          }}
        />
        {input && (
          <button
            type="button"
            aria-label="Clear search"
            className="mr-2 grid size-4 shrink-0 place-items-center"
            onClick={() => setInput("")}
          >
            <CloseCircleOutline className="size-3.5 text-placeholder" />
          </button>
        )}
      </InputGroup>
    </div>
  );
}
