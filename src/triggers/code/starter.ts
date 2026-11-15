/** The new-project guide and CLI share one small, runnable example. */
export function triggerStarter(name: string): string {
  return `import { defineTrigger } from "@mikoagents/hub/triggers";

export default defineTrigger({
  name: ${JSON.stringify(name)},
  description: "Log the incoming event and return its input.",
  // Keep the declared nodes and branches in sync with run(ctx).
  pipeline: {
    nodes: [
      { id: "event", kind: "event", label: "Incoming event", description: "An on-demand run starts this workflow." },
      { id: "prepare", kind: "step", label: "Prepare result", description: "Keep the incoming payload as the result.", operations: ["prepare-result"] },
      { id: "done", kind: "outcome", label: "Result saved", description: "Return the payload and save the completion log." },
    ],
    edges: [{ from: "event", to: "prepare" }, { from: "prepare", to: "done" }],
  },

  // When it runs. Add service events or a schedule here.
  on: [{ source: "manual", event: "run" }],

  // Where it runs, what it can access, and how long it can run.
  runner: "local",
  grants: {},
  limits: { maxRuntime: "10m" },

  // What it does. Write ordinary TypeScript here.
  async run(ctx) {
    const result = await ctx.step("prepare-result", ctx.event.payload, (input) => ({ input }));
    await ctx.log("Trigger completed", result);
    return result;
  },
});
`;
}
