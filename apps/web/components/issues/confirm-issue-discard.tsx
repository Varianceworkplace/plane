/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// ui
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  onDiscard: () => void;
};

/** Closing a new project task with something typed in: discard it, or go back to it (Variance keeps no drafts). */
export function ConfirmIssueDiscard(props: Props) {
  const { isOpen, handleClose, onDiscard } = props;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>Discard this project task?</DialogTitle>
              <DialogDescription>It isn&apos;t saved yet: what you&apos;ve entered will be lost.</DialogDescription>
            </DialogHeading>
          </DialogHeader>
        </DialogMain>
        <DialogActions>
          <Button variant="secondary" size="sm" stretch="auto" onClick={handleClose} label="Keep editing" />
          <Button variant="danger" size="sm" stretch="auto" onClick={onDiscard} label="Discard" />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
