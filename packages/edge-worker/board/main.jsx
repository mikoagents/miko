import { createRoot } from "react-dom/client";
import { BoardApp } from "./router.jsx";

const mount = document.getElementById("root");
if (!mount) throw new Error("Board root element #root is missing");
createRoot(mount).render(<BoardApp />);
