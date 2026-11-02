/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { RichTextEditor } from "@/components/editor/rich-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";

type Props = {
  id: string;
  workspaceSlug: string;
  value: string;
  editable: boolean;
  placeholder?: string;
  onChange?: (html: string) => void;
};

// Ticket rich text: no image upload / embeds, since ticket files live under "Documents".
export const TicketRichTextField = observer(function TicketRichTextField(props: Props) {
  const { id, workspaceSlug, value, editable, placeholder, onChange } = props;
  const { currentWorkspace } = useWorkspace();
  if (!currentWorkspace) return null;

  if (!editable)
    return (
      <RichTextEditor
        id={id}
        editable={false}
        initialValue={value || "<p></p>"}
        workspaceSlug={workspaceSlug}
        workspaceId={currentWorkspace.id}
        disabledExtensions={["image", "issue-embed", "ai", "slash-commands"]}
        containerClassName="!pl-0 border-none"
      />
    );

  return (
    <RichTextEditor
      id={id}
      editable
      initialValue={value || "<p></p>"}
      workspaceSlug={workspaceSlug}
      workspaceId={currentWorkspace.id}
      placeholder={placeholder}
      disabledExtensions={["image", "issue-embed", "ai"]}
      searchMentionCallback={async () => ({})}
      uploadFile={async () => ""}
      duplicateFile={async () => ""}
      onChange={(_json, html) => onChange?.(html)}
      containerClassName="min-h-[160px] rounded-md border-[0.5px] border-subtle bg-surface-1 px-3 py-2"
    />
  );
});
