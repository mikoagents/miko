import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk } from "../../contract/respond.js";
import { respondWithFailure } from "../../failures/index.js";
import { getApplication } from "../../server/runtime.js";
import { jsonValue } from "./contract.js";

const scope = z.object({ organizationSlug: z.string().trim().min(1).max(100) });
const changes = z
  .array(
    z.object({ id: z.string().min(1).max(500), value: z.unknown().transform(jsonValue) }).strict(),
  )
  .max(300);
export const createTemplateTrigger = createServerFn({ method: "POST" })
  .validator(
    scope
      .extend({
        templateId: z.string().min(1).max(100),
        name: z
          .string()
          .regex(/^[a-z][a-z0-9_-]*$/u)
          .max(100),
        changes,
        save: z.boolean(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    try {
      const dashboard = (await getApplication()).triggerDashboard;
      if (!dashboard) throw new Error("Trigger dashboard unavailable");
      return respondOk(await dashboard.createCodeFromTemplate(getRequest(), data));
    } catch (error) {
      return respondWithFailure(
        error,
        {
          operation: "trigger.code.create",
          component: "triggers",
          organizationSlug: data.organizationSlug,
        },
        {
          fallback: error instanceof Error ? error.message : "Hub couldn't create this Trigger.",
          forbidden: "You don't have permission to manage Triggers.",
        },
      );
    }
  });
export const configureCodeTrigger = createServerFn({ method: "POST" })
  .validator(
    scope
      .extend({
        triggerId: z.string().uuid(),
        revisionId: z.string().uuid(),
        save: z.boolean(),
        changes: z
          .array(
            z
              .object({ id: z.string().min(1).max(500), value: z.unknown().transform(jsonValue) })
              .strict(),
          )
          .min(1)
          .max(300),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    try {
      const dashboard = (await getApplication()).triggerDashboard;
      if (!dashboard) throw new Error("Trigger dashboard unavailable");
      return respondOk(await dashboard.configureCode(getRequest(), data));
    } catch (error) {
      return respondWithFailure(
        error,
        {
          operation: "trigger.code.configure",
          component: "triggers",
          organizationSlug: data.organizationSlug,
        },
        {
          fallback: error instanceof Error ? error.message : "Hub couldn't update this Trigger.",
          forbidden: "You don't have permission to manage Triggers.",
        },
      );
    }
  });

export const codeConfigurationResources = createServerFn({ method: "GET" })
  .validator(scope.strict())
  .handler(async ({ data }) => {
    try {
      const dashboard = (await getApplication()).triggerDashboard;
      if (!dashboard) throw new Error("Trigger dashboard unavailable");
      return respondOk(
        await dashboard.codeConfigurationResources(getRequest(), data.organizationSlug),
      );
    } catch (error) {
      return respondWithFailure(
        error,
        {
          operation: "trigger.code.resources",
          component: "triggers",
          organizationSlug: data.organizationSlug,
        },
        { fallback: "Hub couldn't load configuration resources." },
      );
    }
  });
