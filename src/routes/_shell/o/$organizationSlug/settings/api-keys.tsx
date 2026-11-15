import { ApiKeysLoading } from "../../../../../auth/api-key-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { ApiKeys } from "../../../../../auth/api-key-panel.js";

export const Route = createFileRoute("/_shell/o/$organizationSlug/settings/api-keys")({
  staticData: { loadingComponent: ApiKeysLoading, breadcrumb: "API keys" },
  component: ApiKeys,
});
