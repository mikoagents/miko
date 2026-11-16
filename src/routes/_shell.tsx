import { createFileRoute } from "@tanstack/react-router";
import { AccountApp } from "../auth/account-app.js";
import { accountSearchSchema } from "../auth/account-search.js";
import { FailedEntry } from "../auth/account-states.js";
import { accountState } from "../auth/functions.js";

/**
 * The dashboard chrome. Pathless, so the URLs beneath it are unchanged, and mounted
 * once for the whole session — every route below swaps only the panel inside its outlet.
 */
export const Route = createFileRoute("/_shell")({
  validateSearch: accountSearchSchema,
  loaderDeps: ({ search }) => ({ invitation: search.invitation, auth: search.auth }),
  // The account query owns subsequent refreshes. Page navigation must not reload this gate.
  staleTime: Infinity,
  loader: async ({ deps }) => {
    if (deps.auth !== undefined) return { account: undefined };
    const result = await accountState({
      data: deps.invitation === undefined ? {} : { invitation: deps.invitation },
    });
    if (result.status === "error") throw new Error(result.error.message);
    return { account: result.data };
  },
  errorComponent: ({ error }) => <FailedEntry message={error.message} />,
  component: AccountRoute,
});

function AccountRoute() {
  const { account } = Route.useLoaderData();
  const search = Route.useSearch();
  return <AccountApp initialAccount={account} search={search} />;
}
