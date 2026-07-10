import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Disable built-in browser right-click context menu, except on inputs/textareas
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
