import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../../contract/respond.js";
import { respondWithFailure } from "../../failures/index.js";
import { getApplication } from "../../server/runtime.js";
import { findTriggerTemplate } from "./templates.js";
import { templatePreview, type TemplatePreview } from "./template-preview.js";

export const triggerTemplatePreview = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        organizationSlug: z.string().trim().min(1).max(100),
        templateId: z.string().min(1).max(100),
      })
      .strict(),
  )
  .handler(async ({ data }): Promise<Result<TemplatePreview>> => {
    try {
      const application = await getApplication();
      if (application.projectDashboard === null) throw new Error("Project dashboard unavailable");
      await application.projectDashboard.tenantContext(getRequest(), {
        organizationSlug: data.organizationSlug,
      });
      const template = findTriggerTemplate(data.templateId);
      if (template === undefined) throw new Error("Template unavailable");
      return respondOk(templatePreview(template));
    } catch (error) {
      return respondWithFailure(
        error,
        {
          operation: "trigger.template.preview",
          component: "triggers",
          organizationSlug: data.organizationSlug,
        },
        { fallback: "Hub couldn't load this template preview. Try again." },
      );
    }
  });
