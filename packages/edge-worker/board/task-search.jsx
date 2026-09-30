import { useState } from "react";
import { createRoot } from "react-dom/client";
import { InputField, InputGroup } from "./fluid/components/ui/input-group";

function TaskSearchField({ onQueryChange }) {
	const [value, setValue] = useState("");
	return (
		<InputGroup className="task-search w-full max-w-full" size="compact">
			<InputField
				label="Search tasks"
				labelHidden
				index={0}
				type="search"
				value={value}
				autoComplete="off"
				onChange={(next) => {
					setValue(next);
					onQueryChange(next);
				}}
				placeholder="Search tasks…"
			/>
		</InputGroup>
	);
}

/** Mount Fluid compact search into #task-search-root; returns a getter for the query. */
export function mountTaskSearch(container, onQueryChange) {
	createRoot(container).render(
		<TaskSearchField onQueryChange={onQueryChange} />,
	);
}
