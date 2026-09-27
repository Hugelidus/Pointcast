import { CustomersPanel } from "../components/CustomersPanel";
import { HeaderBar } from "../components/HeaderBar";
import { SettingsForm } from "../components/SettingsForm";

export function Settings() {
  return (
    <div className="page">
      <HeaderBar title="Settings" />
      <SettingsForm />
      <CustomersPanel />
    </div>
  );
}
