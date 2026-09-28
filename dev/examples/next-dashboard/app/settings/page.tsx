import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Choose how Acme Ops keeps you informed.</p>
      <SettingsForm />
    </>
  );
}
