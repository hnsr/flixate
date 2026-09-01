import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { UpdatePrompt } from "./app/UpdatePrompt.js";
import "./app/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdatePrompt />
  </StrictMode>,
);
