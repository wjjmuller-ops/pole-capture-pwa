import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      console.log("Service worker registration skipped.");
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);