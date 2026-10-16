import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getFinancialSettings } from "@/domain/financial-settings/service";
import { ModuleGate } from "@/components/common/module-gate";
import { ErrorState } from "@/components/common/empty-state";
import { FinancialSettingsForm } from "@/components/financial-settings/financial-settings-form";

export const metadata: Metadata = { title: "Quote & invoice settings" };

export default async function FinancialSettingsPage() {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const result = await getFinancialSettings(ctx);
  return (
    <ModuleGate permission="settings.read">
      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <FinancialSettingsForm
          settings={result.data.settings}
          business={result.data.business}
          canEdit={app.permissions.can("settings.update")}
          canEditAddress={app.permissions.can("settings.update") && app.permissions.can("organisation.update")}
        />
      )}
    </ModuleGate>
  );
}
