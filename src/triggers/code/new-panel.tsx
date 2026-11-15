/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- guide cards compose shared controls and typed tenant links */
/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- organization paths use the server-resolved tenant slug */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "../../components/app/card.js";
import { CopyBlock } from "../../components/app/copy-field.js";
import { Disclosure } from "../../components/app/disclosure.js";
import { PageHeader } from "../../components/app/page.js";
import { Steps } from "../../components/app/steps.js";
import { Button } from "../../components/ui/button.js";
import { useRouteTenant } from "../../projects/context.js";
import { triggerStarter } from "./starter.js";
import { findTriggerTemplate, triggerTemplateSource } from "./templates.js";
import { TemplateSetup } from "./template-setup.js";

export function NewTriggerPanel({ templateId }: { templateId?: string | undefined }) {
  const { organization } = useRouteTenant();
  const template = findTriggerTemplate(templateId);
  const projectName = template?.id ?? "my-trigger";
  const [origin, setOrigin] = useState("<hub-url>");
  const [exampleOpen, setExampleOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `'${origin.replaceAll("'", "'\\''")}'`;
  return (
    <>
      <PageHeader
        title="New trigger"
        description="Choose when it runs. Write what it does. Deploy it to Hub."
      >
        <Button variant="outline" asChild>
          <Link
            to="/o/$organizationSlug/triggers"
            params={{ organizationSlug: organization.slug }}
            search={{ scope: "explore" }}
          >
            {template === undefined ? "Browse templates" : "Choose another template"}
          </Link>
        </Button>
      </PageHeader>
      <Steps>
        <Card
          title={template?.name ?? "Write your workflow"}
          description={
            template?.description ??
            "Start with a working script, then add your conditions, loops and API calls."
          }
        >
          <CopyBlock
            label="Create a project"
            action="Copy command"
            value={`miko trigger init ${projectName}${template === undefined ? "" : ` --template ${template.id}`}`}
          />
          {template === undefined ? (
            <p className="text-sm text-muted-foreground">
              Edit <code>{projectName}/trigger.ts</code>. <code>on</code> declares the events that
              start it;
              <code> run(ctx)</code> is the code that runs. The starter has an on-demand entry so
              you can try it immediately.
            </p>
          ) : (
            <div className="grid gap-3 text-sm text-muted-foreground">
              <p>
                Template version {template.version}. The project records its template ID and version
                in the script, and keeps <code>.miko-template.json</code> for future upgrades.
              </p>
              <p>
                Edit <code>{projectName}/trigger.ts</code> and fill in <code>settings</code>: your
                runner, daemon, working directory and native provider options. Fill the inputs
                required by this template and review its grants before deploying.
              </p>
              <TemplateSetup template={template} hubUrl={url} />
              <p>
                Original prompt by{" "}
                <a href={template.sourceUrl} target="_blank" rel="noreferrer" className="text-link">
                  Cursor
                </a>
                . The script explicitly adapts Cursor’s Slack, memory and PR tools for Hub.
              </p>
              <Disclosure
                id="trigger-template-prompt"
                title="Read the original prompt"
                open={promptOpen}
                onOpenChange={setPromptOpen}
              >
                <CopyBlock label="Original prompt" action="Copy prompt" value={template.prompt} />
              </Disclosure>
            </div>
          )}
          <Disclosure
            id="trigger-starter"
            title={template === undefined ? "See the starter script" : "See the Trigger script"}
            open={exampleOpen}
            onOpenChange={setExampleOpen}
          >
            <CopyBlock
              label="trigger.ts"
              action="Copy code"
              value={
                template === undefined
                  ? triggerStarter(projectName)
                  : triggerTemplateSource(template)
              }
            />
          </Disclosure>
        </Card>
        <Card
          title="Connect to your Hub"
          description="Use an organization API key for deployment and a runner to execute your scripts."
        >
          <p className="text-sm text-muted-foreground">
            Create an API key with Install configuration and Validate configuration
            {template?.trigger.transport === "bridge" ? ", plus Dispatch runs" : ""} permissions.
            Save its value in a private file called <code>hub.key</code> outside{" "}
            <code>{projectName}</code>.
          </p>
          <div>
            <Button variant="outline" asChild>
              <Link to={`/o/${organization.slug}/settings/api-keys` as never}>Manage API keys</Link>
            </Button>
          </div>
          <Disclosure
            id="trigger-runner-setup"
            title="Set up a runner once"
            description="Skip this if your chosen runner is already running."
            open={runnerOpen}
            onOpenChange={setRunnerOpen}
          >
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                The starter uses a runner named <code>local</code>. Run these commands on the
                machine that will execute your script and leave the runner running. A Miko daemon is
                needed when your code calls an agent.
              </p>
              <CopyBlock
                label="Start the local runner"
                action="Copy commands"
                value={`miko trigger runner-enroll local --url ${url} --token-file ./hub.key --out ./runner.key\nmiko trigger runner --url ${url} --token-file ./runner.key --directory ./runner-data${template?.notifySlack ? " --secrets-file /private/secrets.json" : ""}`}
              />
            </div>
          </Disclosure>
        </Card>
        <Card
          title="Deploy and try it"
          description="Check the script, deploy it, then open your Trigger and choose Run now."
        >
          <CopyBlock
            label="Check and deploy"
            action="Copy commands"
            value={`miko trigger check ${projectName}/trigger.ts\nmiko trigger deploy ${projectName}/trigger.ts --url ${url} --token-file ./hub.key`}
          />
          <p className="text-sm text-muted-foreground">
            Results and logs appear in the Trigger’s Run history. After editing the script, deploy
            again with the same name to update this Trigger and keep its history.
          </p>
          <div>
            <Button variant="outline" asChild>
              <Link to={`/o/${organization.slug}/triggers` as never}>View triggers</Link>
            </Button>
          </div>
        </Card>
      </Steps>
    </>
  );
}
