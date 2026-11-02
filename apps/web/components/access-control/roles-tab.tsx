/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { AddOutline, CopyOutline, DeleteOutline, EditOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// local imports
import {
  ACTION_LABELS,
  SCOPE_LABELS,
  accessControlService,
  fromMatrix,
  toMatrix,
  toastError,
  useRoles,
} from "./helpers";
import type { TPermissionMatrix } from "./helpers";
import type { TAccessControl, TRbacAction, TRbacScope, TRole } from "./types";

type TScopeOption = { id: string; label: string };

function ScopeSelect<S extends string>(props: {
  value: S | undefined;
  onChange: (value: S | undefined) => void;
  scopes: TRbacScope[];
  label: string;
  /** the empty choice follows the roles (a team's Lead permissions), and "none" is Not allowed */
  inherit?: string;
}) {
  const { value, onChange, scopes, label, inherit } = props;
  const options: TScopeOption[] = [
    ...(inherit
      ? [
          { id: "", label: inherit },
          { id: "none", label: "Not allowed" },
        ]
      : [{ id: "", label: "Not allowed" }]),
    ...scopes.map((scope) => ({ id: scope, label: SCOPE_LABELS[scope].label })),
  ];
  const selected = options.find((option) => option.id === (value ?? "")) ?? options[0];
  return (
    <Select<TScopeOption>
      getValues={() => options}
      value={selected}
      onChange={(id) => onChange((id || undefined) as S | undefined)}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.label}
      showSearch={false}
      pinSelected={false}
    >
      <Select.Trigger<TScopeOption> variant="select-md" className="w-full" aria-label={label}>
        <span className={cn("truncate text-left", value ? "text-primary" : "text-placeholder")}>{selected.label}</span>
      </Select.Trigger>
    </Select>
  );
}

/** The module x action grid of scopes, with what each scope reaches. */
export function PermissionGrid<S extends string>(props: {
  overview: TAccessControl;
  matrix: TPermissionMatrix<S>;
  onChange: (module: string, action: TRbacAction, scope: S | undefined) => void;
  /** see ScopeSelect */
  inherit?: string;
}) {
  const { overview, matrix, onChange, inherit } = props;
  return (
    <>
      <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
        <table className="w-full min-w-[640px] border-collapse text-body-xs-regular">
          <thead>
            <tr className="border-b-[0.5px] border-subtle bg-layer-1">
              <th className="px-3 py-2 text-left text-caption-md-medium text-tertiary">Module</th>
              {overview.actions.map((action) => (
                <th key={action} className="px-2 py-2 text-left text-caption-md-medium text-tertiary">
                  {ACTION_LABELS[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overview.modules.map((module) => (
              <tr key={module.key} className="border-b-[0.5px] border-subtle last:border-b-0">
                <td className="px-3 py-1.5 text-body-xs-medium whitespace-nowrap text-primary">{module.label}</td>
                {overview.actions.map((action) => (
                  <td key={action} className="w-36 px-2 py-1.5">
                    <ScopeSelect<S>
                      value={matrix[module.key]?.[action]}
                      onChange={(scope) => onChange(module.key, action, scope)}
                      scopes={overview.scopes}
                      label={`${module.label}: ${ACTION_LABELS[action]}`}
                      inherit={inherit}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-caption-md-regular sm:grid-cols-2">
        {overview.scopes.map((scope) => (
          <div key={scope} className="flex gap-1.5">
            <dt className="font-medium text-secondary">{SCOPE_LABELS[scope].label}:</dt>
            <dd className="text-tertiary">{SCOPE_LABELS[scope].description}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Name, description and the module x action grid of scopes. */
function RoleEditor(props: {
  open: boolean;
  workspaceSlug: string;
  overview: TAccessControl;
  /** edit this role; with `copy` start a new one from it */
  role: TRole | null;
  copy: boolean;
  onClose: (saved: boolean) => void;
}) {
  const { open, workspaceSlug, overview, role, copy, onClose } = props;
  const isEdit = !!role && !copy;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [matrix, setMatrix] = useState<TPermissionMatrix>({});
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role ? (copy ? `${role.name} (copy)` : role.name) : "");
    setDescription(role?.description ?? "");
    setMatrix(role ? toMatrix(role.permissions) : {});
    setNameError("");
  }, [open, role, copy]);

  const setScope = (module: string, action: TRbacAction, scope: TRbacScope | undefined) =>
    setMatrix((previous) => ({ ...previous, [module]: { ...previous[module], [action]: scope } }));

  const save = async () => {
    if (!name.trim()) {
      setNameError("Give the role a name.");
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description, permissions: fromMatrix(matrix) };
      if (isEdit && role) await accessControlService.updateRole(workspaceSlug, role.id, payload);
      else await accessControlService.createRole(workspaceSlug, payload);
      setToast({ type: "success", title: isEdit ? "Role updated" : "Role created", message: name.trim() });
      onClose(true);
    } catch (error) {
      const data = (error ?? {}) as Record<string, string>;
      if (data.name) setNameError(data.name);
      else toastError("Role not saved", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="xl">
        <div className="px-5 pt-5">
          <DialogTitle>{isEdit ? `Edit ${role?.name}` : "New role"}</DialogTitle>
          {role?.is_system && isEdit && (
            <p className="mt-1 text-caption-md-regular text-tertiary">
              A built-in role: its name and permissions can be changed, it can't be deleted.
            </p>
          )}
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-body-xs-medium text-secondary">
                  Name <span className="text-danger-primary">*</span>
                </span>
                <InputGroup size="md">
                  <Input
                    size="md"
                    maxLength={100}
                    placeholder="e.g. Team Lead"
                    value={name}
                    aria-invalid={!!nameError || undefined}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError("");
                    }}
                  />
                </InputGroup>
                {nameError && <span className="text-caption-md-regular text-danger-primary">{nameError}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-body-xs-medium text-secondary">Description</span>
                <TextAreaGroup resize="none">
                  <TextArea
                    size="md"
                    surface="field"
                    autoResize
                    maxRows={3}
                    placeholder="Who this role is for"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </TextAreaGroup>
              </div>
            </div>

            <PermissionGrid overview={overview} matrix={matrix} onChange={setScope} />
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={isEdit ? "Save changes" : "Create role"}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** Every role: built-in ones first, how many people hold each, and a summary of what it allows. */
export const AccessRolesTab = observer(function AccessRolesTab(props: {
  workspaceSlug: string;
  overview: TAccessControl;
}) {
  const { workspaceSlug, overview } = props;
  const { roles, mutate } = useRoles(workspaceSlug);
  const [editing, setEditing] = useState<{ role: TRole | null; copy: boolean } | null>(null);

  const remove = async (role: TRole) => {
    try {
      await accessControlService.deleteRole(workspaceSlug, role.id);
      setToast({ type: "success", title: "Role deleted", message: role.name });
      void mutate();
    } catch (error) {
      toastError("Role not deleted", error);
    }
  };

  const moduleLabel = (key: string) => overview.modules.find((module) => module.key === key)?.label ?? key;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-xs-regular text-tertiary">
          A role grants actions on modules; the scope says which records they reach. People can hold several roles: what
          they grant adds up.
        </p>
        <Button
          stretch="auto"
          variant="primary"
          size="md"
          label="New role"
          icon={<Icon icon={AddOutline} />}
          onClick={() => setEditing({ role: null, copy: false })}
        />
      </div>
      <div className="flex flex-col rounded-lg border-[0.5px] border-subtle">
        {(roles ?? []).map((role) => {
          const modules = [...new Set(role.permissions.map((p) => p.module))];
          return (
            <div
              key={role.id}
              className="flex items-start gap-3 border-b-[0.5px] border-subtle px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="truncate text-body-sm-medium text-primary hover:underline"
                    onClick={() => setEditing({ role, copy: false })}
                  >
                    {role.name}
                  </button>
                  {role.is_system && (
                    <span className="rounded-sm bg-layer-1 px-1.5 py-0.5 text-caption-sm-medium text-tertiary">
                      Built-in
                    </span>
                  )}
                </span>
                {role.description && <span className="text-body-xs-regular text-secondary">{role.description}</span>}
                <span className="text-caption-md-regular text-tertiary">
                  {modules.length ? modules.map(moduleLabel).join(" · ") : "No permissions yet"}
                </span>
              </div>
              <span className="shrink-0 pt-0.5 text-caption-md-regular whitespace-nowrap text-tertiary">
                {role.holder_count} {role.holder_count === 1 ? "person" : "people"}
              </span>
              <Menu>
                <MenuTrigger
                  render={
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={MoreHorizontalOutline} />}
                      aria-label={`${role.name} options`}
                    />
                  }
                />
                <MenuContent side="bottom" align="end">
                  <MenuItem
                    label="Edit"
                    icon={<Icon icon={EditOutline} />}
                    onClick={() => setEditing({ role, copy: false })}
                  />
                  <MenuItem
                    label="Make a copy"
                    icon={<Icon icon={CopyOutline} />}
                    onClick={() => setEditing({ role, copy: true })}
                  />
                  {!role.is_system && (
                    <MenuItem
                      label={role.holder_count ? "Delete (give its people another role first)" : "Delete"}
                      icon={<Icon icon={DeleteOutline} />}
                      disabled={role.holder_count > 0}
                      onClick={() => void remove(role)}
                    />
                  )}
                </MenuContent>
              </Menu>
            </div>
          );
        })}
      </div>
      <RoleEditor
        open={!!editing}
        workspaceSlug={workspaceSlug}
        overview={overview}
        role={editing?.role ?? null}
        copy={!!editing?.copy}
        onClose={(saved) => {
          setEditing(null);
          if (saved) void mutate();
        }}
      />
    </div>
  );
});
