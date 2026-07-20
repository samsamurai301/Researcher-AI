import React from "react";
import { createRoot } from "react-dom/client";
import { ResearcherWidget } from "./ResearcherWidget.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ResearcherWidget />
  </React.StrictMode>,
);
