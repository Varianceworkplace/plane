/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Controller, useFormContext } from "react-hook-form";
// plane imports
import { Select } from "@plane/blocks/select";
import type { TNetworkChoice } from "@plane/constants";
import { NETWORK_CHOICES, ETabIndices } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IProject } from "@plane/types";
import { getTabIndex } from "@plane/utils";
// components
import { ProjectNetworkIcon } from "@/components/project/project-network-icon";

type Props = {
  isMobile?: boolean;
};

function ProjectAttributes(props: Props) {
  const { isMobile = false } = props;
  const { t } = useTranslation();
  const { control } = useFormContext<IProject>();
  const { getIndex } = getTabIndex(ETabIndices.PROJECT_CREATE, isMobile);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Controller
        name="network"
        control={control}
        render={({ field: { onChange, value } }) => {
          const currentNetwork = NETWORK_CHOICES.find((n) => n.key === value);

          return (
            <Select<TNetworkChoice>
              getValues={() => NETWORK_CHOICES}
              value={currentNetwork ?? null}
              onChange={(key) => onChange(Number(key))}
              getOptionValue={(network) => String(network.key)}
              getOptionLabel={(network) => t(network.i18n_label)}
              getOptionIcon={(network) => (
                <ProjectNetworkIcon iconKey={network.iconKey} className="mt-0.5 size-4 shrink-0" />
              )}
              getOptionDescription={(network) => t(network.description)}
              placeholder={t("select_network")}
              showSearch={false}
              pinSelected={false}
              estimateItemSize={64}
            >
              <Select.Trigger<TNetworkChoice>
                variant="pill-md"
                tabIndex={getIndex("network")}
                prependIcon={(networks) =>
                  networks[0] ? <ProjectNetworkIcon iconKey={networks[0].iconKey} /> : undefined
                }
              >
                {(networks) => (
                  <span className="truncate">{networks[0] ? t(networks[0].i18n_label) : t("select_network")}</span>
                )}
              </Select.Trigger>
            </Select>
          );
        }}
      />
    </div>
  );
}

export default ProjectAttributes;

export { ProjectAttributes };
