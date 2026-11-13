import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import { OrganizationApiKeys } from "./api-keys.js";
import { OrganizationCliCredentials } from "./cli-credentials.js";
import { PublicCredentialAuthenticator } from "./public-credentials.js";

describe("credentials issued before the Miko rename", () => {
  let directory: string;
  let bundle: DatabaseRuntimeBundle;
  let apiKeys: OrganizationApiKeys;
  let cliCredentials: OrganizationCliCredentials;
  let credentials: PublicCredentialAuthenticator;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "miko-credential-upgrade-"));
    bundle = await embeddedDatabaseRuntime(directory);
    await bundle.runtime.migrate();
    await bundle.runtime.query(
      `insert into organization (id, name, slug) values ('upgrade-org', 'Miko Hub', 'upgrade-org')`,
    );
    await bundle.runtime.query(
      `insert into "user" (id, name, email, email_verified) values ('upgrade-owner', 'Owner', 'upgrade@example.test', true)`,
    );
    await bundle.runtime.query(
      `insert into member (id, organization_id, user_id, role) values ('upgrade-member', 'upgrade-org', 'upgrade-owner', 'owner')`,
    );
    apiKeys = new OrganizationApiKeys(bundle.runtime, bundle.locks);
    cliCredentials = new OrganizationCliCredentials(bundle.runtime);
    credentials = new PublicCredentialAuthenticator(apiKeys, cliCredentials);
  }, 120_000);

  afterAll(async () => {
    await bundle?.runtime.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps a stored Paseo API key valid, scoped and revocable", async () => {
    const id = randomUUID();
    const prefix = "paseo_pk_abcdefgh1234";
    const token = `${prefix}_retained-secret`;
    await bundle.runtime.query(
      `insert into organization_api_keys (id, organization_id, name, prefix, verifier, scopes, created_by_user_id)
       values ($1, 'upgrade-org', 'retained', $2, $3, $4, 'upgrade-owner')`,
      [id, prefix, verifier(token), ["runs:dispatch"]],
    );
    const result = await credentials.authorize(request(token), "runs:dispatch");
    assert.equal(result.status, "authorized");
    if (result.status === "authorized") assert.equal(result.access.organizationId, "upgrade-org");
    assert.equal(
      (await credentials.authorize(request(token), "daemons:enroll")).status,
      "forbidden",
    );
    assert.equal(
      (await credentials.authorize(request(`${prefix}_wrong`), "runs:dispatch")).status,
      "unauthorized",
    );
    await apiKeys.revoke("upgrade-org", id);
    assert.equal(
      (await credentials.authorize(request(token), "runs:dispatch")).status,
      "unauthorized",
    );
  });

  it.each(["paseo", "miko"])(
    "keeps a stored %s CLI credential valid and revocable",
    async (namespace) => {
      const id = randomUUID();
      const prefix = `${namespace}_cli_abcdefgh1234`;
      const token = `${prefix}_retained-secret`;
      await bundle.runtime.query(
        `insert into organization_cli_credentials (id, organization_id, prefix, verifier, created_by_user_id)
       values ($1, 'upgrade-org', $2, $3, 'upgrade-owner')`,
        [id, prefix, verifier(token)],
      );
      const result = await credentials.authorize(request(token), "runs:dispatch");
      assert.equal(result.status, "authorized");
      if (result.status === "authorized") assert.equal(result.access.organizationId, "upgrade-org");
      assert.equal(
        (await credentials.authorize(request(`${prefix}_wrong`), "runs:dispatch")).status,
        "unauthorized",
      );
      await cliCredentials.revoke("upgrade-org", id);
      assert.equal(
        (await credentials.authorize(request(token), "runs:dispatch")).status,
        "unauthorized",
      );
    },
  );

  it("issues new API keys with the Miko prefix", async () => {
    const key = await apiKeys.create("upgrade-org", "upgrade-owner", "new key", ["runs:dispatch"]);
    assert.match(key.secret, /^miko_pk_/u);
    assert.equal(
      (await credentials.authorize(request(key.secret), "runs:dispatch")).status,
      "authorized",
    );
  });
});

function verifier(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function request(token: string): Request {
  return new Request("http://localhost/api/v1/triggers", {
    headers: { authorization: `Bearer ${token}` },
  });
}
