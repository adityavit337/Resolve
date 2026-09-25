"use client";

export default function CustomerError({ reset }: { reset: () => void }) {
  return <main className="app-content"><p role="alert">Could not load your tickets. Please try again.</p><button onClick={reset}>Try again</button></main>;
}
