import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <main>tslog tanstack-start e2e fixture</main>,
});
