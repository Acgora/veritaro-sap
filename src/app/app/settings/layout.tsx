import { PageHeader } from "@/components/common/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Settings" />
      <SettingsTabs />
      <div className="mt-5 max-w-2xl">{children}</div>
    </div>
  );
}
