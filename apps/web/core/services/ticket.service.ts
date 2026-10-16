/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
// plane imports
import { API_BASE_URL } from "@plane/constants";
import { generateFileUploadPayload, getFileMetaDataForUpload } from "@plane/services";
// types
import type {
  TTicket,
  TTicketAttachment,
  TTicketComment,
  TTicketHistory,
  TTicketListParams,
  TTicketListResponse,
  TTicketMeta,
  TTicketPayload,
} from "@/components/tickets/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

export class TicketService extends APIService {
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.fileUploadService = new FileUploadService();
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/tickets/`;
  }

  async meta(workspaceSlug: string): Promise<TTicketMeta> {
    return this.get(`${this.base(workspaceSlug)}meta/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async list(workspaceSlug: string, params: TTicketListParams): Promise<TTicketListResponse> {
    return this.get(this.base(workspaceSlug), { params })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: TTicketPayload): Promise<TTicket> {
    return this.post(this.base(workspaceSlug), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, ticketId: string): Promise<TTicket> {
    return this.get(`${this.base(workspaceSlug)}${ticketId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, ticketId: string, data: TTicketPayload): Promise<TTicket & { visible?: false }> {
    return this.patch(`${this.base(workspaceSlug)}${ticketId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkUpdate(
    workspaceSlug: string,
    ticketIds: string[],
    changes: TTicketPayload
  ): Promise<{ updated: string[]; skipped: string[] }> {
    return this.patch(`${this.base(workspaceSlug)}bulk-update/`, { ticket_ids: ticketIds, changes })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async bulkComment(workspaceSlug: string, ticketIds: string[], commentHtml: string): Promise<{ added: number }> {
    return this.post(`${this.base(workspaceSlug)}bulk-comment/`, { ticket_ids: ticketIds, comment_html: commentHtml })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  exportUrl(workspaceSlug: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    return `${API_BASE_URL}${this.base(workspaceSlug)}export/${query ? `?${query}` : ""}`;
  }

  async comments(workspaceSlug: string, ticketId: string): Promise<TTicketComment[]> {
    return this.get(`${this.base(workspaceSlug)}${ticketId}/comments/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async addComment(
    workspaceSlug: string,
    ticketId: string,
    commentHtml: string,
    parentId?: string
  ): Promise<TTicketComment> {
    return this.post(`${this.base(workspaceSlug)}${ticketId}/comments/`, {
      comment_html: commentHtml,
      parent_id: parentId,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async editComment(
    workspaceSlug: string,
    ticketId: string,
    commentId: string,
    commentHtml: string
  ): Promise<TTicketComment> {
    return this.patch(`${this.base(workspaceSlug)}${ticketId}/comments/${commentId}/`, { comment_html: commentHtml })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async history(workspaceSlug: string, ticketId: string): Promise<TTicketHistory[]> {
    return this.get(`${this.base(workspaceSlug)}${ticketId}/history/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async attachments(workspaceSlug: string, ticketId: string): Promise<TTicketAttachment[]> {
    return this.get(`${this.base(workspaceSlug)}${ticketId}/attachments/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  attachmentDownloadUrl(workspaceSlug: string, ticketId: string, attachmentId: string): string {
    return `${API_BASE_URL}${this.base(workspaceSlug)}${ticketId}/attachments/${attachmentId}/`;
  }

  async uploadAttachment(
    workspaceSlug: string,
    ticketId: string,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TTicketAttachment> {
    const fileMetaData = await getFileMetaDataForUpload(file);
    try {
      const response = await this.post(`${this.base(workspaceSlug)}${ticketId}/attachments/`, fileMetaData);
      const signed = response?.data;
      await this.fileUploadService.uploadFile(
        signed.upload_data.url,
        generateFileUploadPayload(signed, file),
        uploadProgressHandler
      );
      const done = await this.patch(`${this.base(workspaceSlug)}${ticketId}/attachments/${signed.asset_id}/`);
      return done?.data;
    } catch (error: unknown) {
      throw (error as { response?: { data?: unknown } })?.response?.data ?? error;
    }
  }
}
