"use client";

export default function TicketError({ reset }: { reset: () => void }) {
  return <main><h1>Could not load this ticket</h1><p role="alert">Please try again.</p><button onClick={reset}>Try again</button><p><a href="/">Return to inbox</a></p></main>;
}
