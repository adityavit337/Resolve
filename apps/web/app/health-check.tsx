"use client";

import { useState } from "react";

export default function HealthCheck() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("Server connection has not been checked yet.");

  async function checkHealth() {
    setIsLoading(true);
    setMessage("Checking server connection...");

    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });

      // fetch does not throw for HTTP errors such as 404 or 500.
      if (!response.ok) {
        throw new Error("Health request failed.");
      }

      const data: unknown = await response.json();
      if (
        typeof data !== "object" || data === null ||
        !("status" in data) || data.status !== "ok"
      ) {
        throw new Error("Unexpected health response.");
      }

      setMessage("Server connection successful. Status: ok.");
    } catch {
      setMessage("Could not confirm the server connection. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section aria-labelledby="connection-heading">
      <h2 id="connection-heading">Server connection</h2>
      <button type="button" onClick={checkHealth} disabled={isLoading}>
        {isLoading ? "Checking..." : "Check connection"}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
