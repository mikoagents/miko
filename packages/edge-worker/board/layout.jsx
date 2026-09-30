import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, BookOpen, CalendarClock, ListTodo } from "lucide-react";
import { useEffect } from "react";
import mikoLogo from "./assets/miko.jpg";
import { boardPageFromHash, boardPageTitle } from "./board-route.mjs";
import { BoardSessionProvider } from "./board-session.jsx";
import { Button } from "./fluid/components/ui/button";
import { ShapeProvider } from "./fluid/lib/shape-context";
import "./fluid/theme.css";
import "./automations.css";
import "./layout.css";

function NavItem({ to, id, icon: Icon, children }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const active = pathname === to;
	return (
		<Button
			id={id}
			variant="ghost"
			active={active}
			leadingIcon={Icon}
			asChild
			aria-current={active ? "page" : undefined}
		>
			<Link to={to}>{children}</Link>
		</Button>
	);
}

function BoardNav() {
	return (
		<nav className="board-navigation" aria-label="Board pages">
			<div className="fluid-scope automation-navigation">
				<a className="automation-brand" href="/board" aria-label="Miko home">
					<span className="automation-brand-mark" aria-hidden="true">
						<img src={mikoLogo} alt="" />
					</span>
					<span>Miko</span>
				</a>
				<div className="automation-nav-items">
					<NavItem to="/tasks" id="show-tasks" icon={ListTodo}>
						Tasks & logs
					</NavItem>
					<NavItem to="/schedules" id="show-automations" icon={CalendarClock}>
						Schedules
					</NavItem>
					<NavItem to="/skills" id="show-skills" icon={BookOpen}>
						Skills
					</NavItem>
					<NavItem to="/status" id="show-status" icon={Activity}>
						Status
					</NavItem>
				</div>
				<span className="automation-local">
					<span />
					Local workspace
				</span>
			</div>
		</nav>
	);
}

function DocumentTitle() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	useEffect(() => {
		document.title = boardPageTitle(boardPageFromHash(`#${pathname}`));
	}, [pathname]);
	return null;
}

export function BoardLayout() {
	return (
		<BoardSessionProvider>
			<ShapeProvider defaultShape="rounded">
				<DocumentTitle />
				<BoardNav />
				<Outlet />
			</ShapeProvider>
		</BoardSessionProvider>
	);
}
