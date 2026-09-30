import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";
import { SchedulesPage } from "./automations.jsx";
import { BoardLayout } from "./layout.jsx";
import { SkillsPage } from "./skills.jsx";
import { StatusPage } from "./status.jsx";
import { TasksPage } from "./tasks-page.jsx";

const rootRoute = createRootRoute({
	component: BoardLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});

const tasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tasks",
	component: TasksPage,
});

const schedulesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/schedules",
	component: SchedulesPage,
});

const automationsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/automations",
	beforeLoad: () => {
		throw redirect({ to: "/schedules" });
	},
});

const statusRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/status",
	component: StatusPage,
});

const skillsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/skills",
	component: SkillsPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	tasksRoute,
	schedulesRoute,
	automationsRedirectRoute,
	statusRoute,
	skillsRoute,
]);

const hashHistory = createHashHistory();

export const router = createRouter({
	routeTree,
	history: hashHistory,
	defaultPreload: "intent",
});

export function BoardApp() {
	return <RouterProvider router={router} />;
}
