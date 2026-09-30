import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

const BoardSessionContext = createContext({
	selectedId: null,
	selectSession: () => {},
	setSelectedId: () => {},
});

export function BoardSessionProvider({ children }) {
	const [selectedId, setSelectedId] = useState(null);
	const selectSession = useCallback((id) => {
		setSelectedId(id ?? null);
	}, []);
	const value = useMemo(
		() => ({ selectedId, selectSession, setSelectedId }),
		[selectedId, selectSession],
	);
	return (
		<BoardSessionContext.Provider value={value}>
			{children}
		</BoardSessionContext.Provider>
	);
}

export function useBoardSession() {
	return useContext(BoardSessionContext);
}
