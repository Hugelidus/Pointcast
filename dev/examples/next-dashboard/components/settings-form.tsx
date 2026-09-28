"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Client Component: a form whose state lives in the browser. */
export function SettingsForm() {
  const [email, setEmail] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <label className="toggle">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
        Email notifications
      </label>
      <Button type="submit">Save changes</Button>
      {saved ? <p className="muted">Saved.</p> : null}
    </form>
  );
}
