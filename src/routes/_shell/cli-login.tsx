import { CliLoginLoading } from "../../cli-authorizations/approval-loading.js";
import { createFileRoute } from "@tanstack/react-router";
import { useActiveAccount } from "../../auth/active-account.js";
import { CliLoginApproval } from "../../cli-authorizations/approval.js";

export const Route = createFileRoute("/_shell/cli-login")({
  staticData: { loadingComponent: CliLoginLoading, breadcrumb: "CLI login" },
  component: CliLogin,
});

function CliLogin() {
  const account = useActiveAccount();
  return (
    <CliLoginApproval accountId={account.account.id} organizationId={account.organization.id} />
  );
}
