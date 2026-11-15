import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { linearCodeOutputContext } from "./agent-host.js";

describe("code trigger Linear output context", () => {
  it("maps a normalized Linear issue onto the reply recipient without copying a credential", () => {
    assert.deepEqual(
      linearCodeOutputContext({
        type: "issue",
        action: "create",
        id: "delivery",
        organizationId: "linear-org",
        actor: null,
        issue: {
          id: "issue-1",
          title: "Crash",
          description: null,
          projectId: null,
          stateId: null,
          assigneeId: null,
          labelIds: [],
        },
        updatedFrom: {},
      }),
      { provider: "linear", linearOrganizationId: "linear-org", issueId: "issue-1" },
    );
  });

  it("uses the comment's issue when the issue object was not embedded", () => {
    assert.deepEqual(
      linearCodeOutputContext({
        type: "comment",
        action: "create",
        id: "delivery",
        organizationId: "linear-org",
        actor: null,
        comment: { id: "comment-1", body: "Still broken", issueId: "issue-2" },
        issue: null,
      }),
      { provider: "linear", linearOrganizationId: "linear-org", issueId: "issue-2" },
    );
  });

  it("accepts an already addressed recipient and ignores payloads with no issue", () => {
    assert.deepEqual(
      linearCodeOutputContext({ linearOrganizationId: "linear-org", issueId: "issue-3" }),
      { provider: "linear", linearOrganizationId: "linear-org", issueId: "issue-3" },
    );
    assert.equal(linearCodeOutputContext({ action: "create", title: "Missing ids" }), undefined);
  });
});
