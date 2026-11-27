/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { redirect } from "react-router";

// Personal Access Tokens were removed from Variance: an old link opens the profile instead
export const clientLoader = () => {
  throw redirect(`/settings/profile/general/`);
};

export default function ApiTokens() {
  return null;
}
