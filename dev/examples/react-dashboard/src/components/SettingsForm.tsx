import { useState } from "react";

interface FormState {
  name: string;
  email: string;
  password: string;
  apiKey: string;
}

const INITIAL_STATE: FormState = { name: "Ana Ríos", email: "ana@example.com", password: "", apiKey: "" };

/** Account form: a password field and a data-sensitive field, neither ever captured (see README, Privacy). */
export function SettingsForm() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);

  return (
    <form className="settings-form" onSubmit={(event) => event.preventDefault()}>
      <h2>Account</h2>
      <label className="field">
        <span>Full name</span>
        <input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      </label>
      <label className="field">
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Store API key</span>
        <input
          type="text"
          data-sensitive="true"
          value={form.apiKey}
          onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Save changes
      </button>
    </form>
  );
}
