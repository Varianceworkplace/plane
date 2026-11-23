/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CloseCircleOutline, HourglassOutline, TickCircleOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { cn, renderFormattedDate } from "@plane/utils";
// services
// hooks
import { useUser } from "@/hooks/store/user";
// services
import { TicketService } from "@/services/ticket.service";
// local imports
import type { TTicket } from "../types";

const ticketService = new TicketService();

/** Small "Waiting for approval" / "Rejected" tag for the ticket list (nothing once approved). */
export function TicketApprovalTag({ ticket }: { ticket: TTicket }) {
  const status = ticket.approval?.status;
  if (status !== "pending" && status !== "rejected") return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-caption-md-medium whitespace-nowrap",
        status === "pending" ? "bg-warning-subtle text-warning-primary" : "bg-danger-subtle text-danger-primary"
      )}
      title={
        status === "pending"
          ? `Waiting for ${ticket.manager?.name ?? "the Manager"}'s approval`
          : `Rejected by ${ticket.approval.decided_by?.name ?? "the Manager"}`
      }
    >
      {status === "pending" ? (ticket.can_approve ? "Needs your approval" : "Waiting for approval") : "Rejected"}
    </span>
  );
}

/**
 * The Manager's approval on the ticket page: Approve / Reject for the Manager while it waits, where it stands for
 * everyone else (the assignee sees and works on the ticket all along).
 */
export const TicketApprovalPanel = observer(function TicketApprovalPanel(props: {
  workspaceSlug: string;
  ticket: TTicket;
  onDecided: (ticket: TTicket) => void;
}) {
  const { workspaceSlug, ticket, onDecided } = props;
  const { data: currentUser } = useUser();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const approval = ticket.approval;
  if (!approval) return null;
  const manager = ticket.manager?.name ?? "the Manager";
  const assignee = ticket.assignee?.name ?? "the assignee";
  const iAmAssignee = !!currentUser && ticket.assignee?.id === currentUser.id;
  const decidedBy = approval.decided_by?.name ?? manager;
  const decidedOn = approval.decided_at ? renderFormattedDate(approval.decided_at) : null;

  const decide = async (decision: "approve" | "reject", note = "") => {
    setBusy(decision);
    try {
      const updated = await ticketService.decideApproval(workspaceSlug, ticket.id, decision, note);
      setToast({
        type: "success",
        title: decision === "approve" ? "Ticket approved" : "Ticket rejected",
        message: `${ticket.ticket_number} moves to ${decision === "approve" ? "Approved" : "Reject"}.`,
      });
      setRejecting(false);
      setReason("");
      onDecided(updated);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string[] | string>;
      const message = Object.values(data).flat()[0];
      setToast({ type: "error", title: "Not saved", message: message ? String(message) : "Please try again." });
    } finally {
      setBusy(null);
    }
  };

  if (approval.status === "approved") {
    // tickets from before approvals existed, or self-approved ones, have nothing to say
    if (!approval.decided_by || approval.decided_by.id === ticket.created_by?.id) return null;
    return (
      <p className="flex items-start gap-2 text-body-xs-regular text-tertiary">
        <TickCircleOutline className="mt-0.5 size-3.5 shrink-0 text-success-primary" />
        <span>
          Approved by <span className="text-secondary">{decidedBy}</span>
          {decidedOn && ` on ${decidedOn}`}
          {approval.note && <span className="text-secondary">: {approval.note}</span>}
        </span>
      </p>
    );
  }

  if (approval.status === "rejected") {
    return (
      <div className="flex items-start gap-3 rounded-lg border-[0.5px] border-danger-subtle bg-danger-subtle px-4 py-3">
        <CloseCircleOutline className="mt-0.5 size-4 shrink-0 text-danger-primary" />
        <div className="flex flex-col gap-0.5 text-body-xs-regular">
          <span className="text-body-sm-medium text-danger-primary">
            Rejected by {decidedBy}
            {decidedOn && ` on ${decidedOn}`}
          </span>
          <span className="text-secondary">{approval.note || "No reason given."}</span>
          <span className="text-tertiary">This ticket goes no further.</span>
        </div>
      </div>
    );
  }

  // waiting
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-[0.5px] border-warning-subtle bg-warning-subtle px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <HourglassOutline className="mt-0.5 size-4 shrink-0 text-warning-primary" />
        <div className="flex flex-col gap-0.5 text-body-xs-regular">
          <span className="text-body-sm-medium text-primary">
            {ticket.can_approve ? "Waiting for your approval" : `Waiting for ${manager}'s approval`}
          </span>
          <span className="text-secondary">
            {ticket.can_approve
              ? `${assignee} can already see and work on it. Approve it to go ahead, or reject it to stop it here.`
              : iAmAssignee
                ? `You can already work on it. ${manager} decides whether it's approved or rejected.`
                : `${assignee} can already work on it. ${manager} decides whether it's approved or rejected.`}
          </span>
        </div>
      </div>
      {ticket.can_approve && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            stretch="auto"
            variant="danger-outline"
            size="md"
            label="Reject"
            disabled={busy !== null}
            onClick={() => setRejecting(true)}
          />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="Approve"
            loading={busy === "approve"}
            disabled={busy !== null}
            onClick={() => void decide("approve")}
          />
        </div>
      )}

      <Dialog open={rejecting} onOpenChange={(open) => !open && setRejecting(false)}>
        <DialogContent size="md">
          <div className="px-5 pt-5">
            <DialogTitle>{`Reject ${ticket.ticket_number}?`}</DialogTitle>
            <p className="mt-1 text-caption-md-regular text-tertiary">
              The ticket moves to Reject and goes no further. {ticket.created_by?.name ?? "The creator"} and {assignee}{" "}
              see your reason.
            </p>
          </div>
          <DialogMain>
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <label htmlFor="ticket-reject-reason" className="text-caption-md-medium text-primary">
                Reason
              </label>
              <TextAreaGroup resize="none">
                <TextArea
                  id="ticket-reject-reason"
                  size="lg"
                  surface="field"
                  autoResize
                  maxRows={8}
                  placeholder="Why it's rejected (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </TextAreaGroup>
            </div>
          </DialogMain>
          <DialogActions>
            <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => setRejecting(false)} />
            <Button
              stretch="auto"
              variant="danger"
              size="md"
              label="Reject ticket"
              loading={busy === "reject"}
              onClick={() => void decide("reject", reason.trim())}
            />
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
});
